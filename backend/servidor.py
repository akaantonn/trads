"""Servidor local de análise morfolóxica para a Biblioteca de Traducións Clásicas.

Uso:  python servidor.py
Rutas:
    GET  /, /estado -> comprobación de estado
    GET  /index.html (e app.js, style.css) -> a propia aplicación, para abrila en http://127.0.0.1:8000/index.html
    POST /analizar  -> {"texto": "...", "idioma": "latin" | "griego", "forzar": false}
    GET  /biblioteca, PUT /biblioteca -> le/garda biblioteca.json na carpeta de datos

Para ter a biblioteca na nube, apunta a carpeta a unha carpeta que sincronice
Google Drive ou OneDrive:   python servidor.py --carpeta "C:/Users/ti/OneDrive/Biblioteca"
"""

import argparse
import hashlib
import json
import os
import re
import shutil
import threading
import time
import traceback
import unicodedata
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

HOST = "127.0.0.1"
PUERTO = 8000
MAX_BYTES = 500_000
MAX_BYTES_BIBLIOTECA = 50_000_000
MAX_ANALISIS_CACHE = 3000       # as análises máis antigas descártanse ao pasar deste número
APLICACION = Path(__file__).resolve().parent
ESTATICOS = {                   # só se serven estes ficheiros (nada máis do disco)
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
}
CARPETA = Path(__file__).resolve().with_name("datos")
_cerrollo_ficheiro = threading.Lock()

# Idioma da web -> código de CLTK
CODIGOS = {"latin": "lat", "lat": "lat", "griego": "grc", "grc": "grc"}

# Só se aceptan páxinas locais (ou file://, que envía Origin: null)
ORIGEN_PERMITIDO = re.compile(r"^(null|https?://(localhost|127\.0\.0\.1)(:\d+)?)$")

_modelos = {}
_erros = {}
_cerrollo = threading.Lock()


# Súbese cando cambia o formato da análise: así non se reutilizan resultados antigos ou defectuosos
VERSION_CACHE = 2


def obtener_nlp(codigo):
    """Carga o modelo de CLTK a primeira vez que se pide (e só unha vez)."""
    with _cerrollo:
        if codigo not in _modelos:
            from cltk import NLP  # importación tardía: o servidor arranca rápido
            _modelos[codigo] = NLP(language_code=codigo, suppress_banner=True)
        return _modelos[codigo]


def explicar_error(error):
    """Convirte os erros típicos de instalación (sobre todo en Windows) en indicacións concretas."""
    detalle = f"{type(error).__name__}: {error}"
    minus = detalle.lower()

    if "only be initialized once" in minus or "reload(torch)" in minus:
        return ("PyTorch fallou ao cargarse antes e Python non pode reintentalo. Pecha este servidor (Ctrl+C) "
                "e arránqueo de novo cando o problema de PyTorch estea arranxado. Detalle: " + detalle)
    if any(p in minus for p in ("dll", "winerror", "torch", "4551", "application control")):
        return ("Non se pode cargar PyTorch (a librería que usa Stanza). En Windows adoita ser que Smart App Control "
                "ou o antivirus bloquea torch_cpu.dll: revisa Seguridade de Windows > Control de aplicacións e navegador, "
                "ou move o entorno virtual fóra de OneDrive (p. ex. C:\\cltk-env). Detalle: " + detalle)
    if isinstance(error, ImportError):
        return f"Falta unha dependencia de CLTK ({error}). Co entorno activado: pip install cltk stanza"
    return f"Erro de CLTK ({type(error).__name__}): {error}"


def precargar(codigo):
    try:
        obtener_nlp(codigo)
        print(f"Modelo '{codigo}' listo.")
    except Exception as error:
        _erros[codigo] = explicar_error(error)
        print(f"Non se puido cargar '{codigo}': {_erros[codigo]}")


# ---------- Tokenización (igual que a expresión regular de app.js) ----------

def _es_letra(c):
    return unicodedata.category(c)[0] in ("L", "M")


def tokenizar(texto):
    """Devolve as palabras na mesma orde e co mesmo criterio que a web:
    letras e marcas, con apóstrofos (’ ou ') só entre letras."""
    palabras = []
    i, n = 0, len(texto)
    while i < n:
        if not _es_letra(texto[i]):
            i += 1
            continue
        j = i
        while j < n:
            if _es_letra(texto[j]):
                j += 1
            elif texto[j] in "’'" and j + 1 < n and _es_letra(texto[j + 1]):
                j += 1
            else:
                break
        palabras.append(texto[i:j])
        i = j
    return palabras


def normalizar(forma):
    """Forma comparable: sen acentos, minúscula, u/v e i/j unificadas, sigma final."""
    base = unicodedata.normalize("NFD", forma or "")
    base = "".join(c for c in base if unicodedata.category(c)[0] == "L").lower()
    return (base.replace("j", "i").replace("v", "u").replace("ς", "σ"))


# ---------- Serialización dos resultados de CLTK ----------

def a_texto(valor):
    if valor is None:
        return None
    nombre = getattr(valor, "name", None)
    return nombre if isinstance(nombre, str) else str(valor)


def extraer_rasgos(palabra):
    paquete = getattr(palabra, "features", None)
    if not paquete:
        return {}
    mapa = getattr(paquete, "features", None)
    if isinstance(mapa, dict):
        rasgos = {}
        for clave, valor in mapa.items():
            nombre = getattr(clave, "__name__", None) or a_texto(clave)
            valores = valor if isinstance(valor, (list, tuple, set)) else [valor]
            rasgos[nombre] = ", ".join(str(a_texto(v)) for v in valores)
        return rasgos

    # UDFeatureTagSet: iterable de etiquetas con .key e .value
    rasgos = {}
    try:
        for etiqueta in paquete:
            clave = getattr(etiqueta, "key", None)
            if clave is not None:
                rasgos[str(clave)] = str(getattr(etiqueta, "value", ""))
    except TypeError:
        pass
    if rasgos:
        return rasgos

    # Último recurso: ler a representación en texto
    patron = r"UDFeatureTag\((\w+)=(.+?)\)(?=,\s*UDFeatureTag|\]\))"
    rasgos = dict(re.findall(patron, str(paquete)))
    return rasgos or {"Rasgos": str(paquete)}


def resumir(palabra):
    return {
        "forma": getattr(palabra, "string", ""),
        "lema": getattr(palabra, "lemma", None),
        "categoria": a_texto(getattr(palabra, "upos", None))
        or a_texto(getattr(palabra, "pos", None)),
        "rasgos": extraer_rasgos(palabra),
    }


def alinear(tokens, palabras_cltk):
    """Asocia cada palabra da web (por posición) coa súa análise de CLTK.
    CLTK pode separar encliticos (virum + que) ou normalizar letras, así que
    se compara a forma normalizada e se tolera unha pequena diferenza de ritmo."""
    formas = [(normalizar(getattr(p, "string", "")), p) for p in palabras_cltk]
    formas = [(f, p) for f, p in formas if f]

    resultado = []
    pos = 0

    for token in tokens:
        buscado = normalizar(token)
        asignado = None

        for j in range(pos, min(pos + 6, len(formas))):
            forma, palabra = formas[j]
            if forma == buscado:
                asignado, pos = palabra, j + 1
                break
            if buscado.startswith(forma):
                acumulado, k = forma, j
                while (acumulado != buscado and k + 1 < len(formas)
                       and buscado.startswith(acumulado + formas[k + 1][0])):
                    acumulado += formas[k + 1][0]
                    k += 1
                if acumulado == buscado:
                    asignado, pos = palabra, k + 1
                    break

        resultado.append(resumir(asignado) if asignado is not None else None)

    return resultado


_cache_analisis = None
_cerrollo_cache = threading.Lock()
_volcado_pendente = None


def _cargar_cache():
    global _cache_analisis
    if _cache_analisis is None:
        try:
            _cache_analisis = json.loads((CARPETA / "analisis.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            _cache_analisis = {}
    return _cache_analisis


def volcar_cache():
    """Escribe analisis.json (en tanda, para non reescribilo con cada petición)."""
    global _volcado_pendente
    with _cerrollo_cache:
        _volcado_pendente = None
        if _cache_analisis is None:
            return
        try:
            CARPETA.mkdir(parents=True, exist_ok=True)
            temporal = CARPETA / "analisis.tmp"
            temporal.write_text(json.dumps(_cache_analisis, ensure_ascii=False), encoding="utf-8")
            os.replace(temporal, CARPETA / "analisis.json")
        except OSError as error:
            print("Non se puido gardar a caché de análise:", error)


def analizar_con_cache(texto, idioma, forzar=False):
    """Devolve (palabras, veu_da_cache). A análise gárdase na carpeta de datos,
    así que tamén se sincroniza coa nube e non hai que repetila."""
    global _volcado_pendente
    codigo = CODIGOS.get(idioma)
    if codigo is None:
        raise ValueError(f"Idioma non soportado: {idioma!r}")

    clave = hashlib.sha1(f"v{VERSION_CACHE}\n{codigo}\n{texto}".encode("utf-8")).hexdigest()

    if not forzar:
        with _cerrollo_cache:
            cache = _cargar_cache()
            if clave in cache:
                return cache[clave], True

    palabras = analizar(texto, idioma)

    # Se CLTK non devolveu ningún lema, devólvese igual pero non se garda na caché
    if tokenizar(texto) and not any(p and p.get("lema") for p in palabras):
        print("Aviso: CLTK non devolveu lemas para este texto; non se garda na caché.")
        return palabras, False

    with _cerrollo_cache:
        cache = _cargar_cache()
        cache[clave] = palabras
        while len(cache) > MAX_ANALISIS_CACHE:
            cache.pop(next(iter(cache)))
        if _volcado_pendente is None:
            _volcado_pendente = threading.Timer(10, volcar_cache)
            _volcado_pendente.daemon = True
            _volcado_pendente.start()

    return palabras, False


def analizar(texto, idioma):
    codigo = CODIGOS.get(idioma)
    if codigo is None:
        raise ValueError(f"Idioma non soportado: {idioma!r}")

    documento = obtener_nlp(codigo).analyze(text=texto)
    return alinear(tokenizar(texto), documento.words)


# ---------- Biblioteca en disco (carpeta sincronizada coa nube) ----------

def leer_biblioteca():
    ruta = CARPETA / "biblioteca.json"
    if not ruta.exists():
        return None
    return json.loads(ruta.read_text(encoding="utf-8"))


def escribir_biblioteca(datos):
    with _cerrollo_ficheiro:
        CARPETA.mkdir(parents=True, exist_ok=True)
        ruta = CARPETA / "biblioteca.json"
        if ruta.exists():
            try:
                shutil.copy2(ruta, CARPETA / "biblioteca.copia.json")
            except OSError as error:
                print("Aviso: non se puido facer a copia de seguridade:", error)
        temporal = CARPETA / "biblioteca.tmp"
        temporal.write_text(json.dumps(datos, ensure_ascii=False, indent=1), encoding="utf-8")
        # OneDrive pode ter o ficheiro bloqueado un instante (WinError 5/32): reintentase
        for intento in range(4):
            try:
                os.replace(temporal, ruta)
                break
            except PermissionError:
                if intento == 3:
                    raise
                time.sleep(0.5)


# ---------- Servidor HTTP ----------

class ServidorCLTK(BaseHTTPRequestHandler):

    def _cabeceras_cors(self):
        origen = self.headers.get("Origin", "")
        if ORIGEN_PERMITIDO.match(origen):
            self.send_header("Access-Control-Allow-Origin", origen)
            self.send_header("Vary", "Origin")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def responder_json(self, datos, codigo=200):
        cuerpo = json.dumps(datos, ensure_ascii=False).encode("utf-8")
        self.send_response(codigo)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(cuerpo)))
        self._cabeceras_cors()
        self.end_headers()
        try:
            self.wfile.write(cuerpo)
        except (BrokenPipeError, ConnectionResetError):
            pass  # o navegador pechou a conexión antes de recibir a resposta

    def responder_ficheiro(self, nome, tipo):
        try:
            cuerpo = (APLICACION / nome).read_bytes()
        except OSError:
            self.error_json(404, f"Non se atopa {nome} xunto a servidor.py")
            return
        self.send_response(200)
        self.send_header("Content-Type", tipo)
        self.send_header("Content-Length", str(len(cuerpo)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        try:
            self.wfile.write(cuerpo)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def error_json(self, codigo, mensaje):
        self.responder_json({"estado": "error", "mensaje": mensaje}, codigo)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cabeceras_cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        ruta = urlparse(self.path).path
        if ruta in ESTATICOS:
            self.responder_ficheiro(*ESTATICOS[ruta])
            return
        if ruta == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return
        if ruta in ("/", "/estado"):
            self.responder_json({
                "estado": "ok",
                "mensaje": "Servidor CLTK funcionando",
                "modelos_cargados": sorted(_modelos),
                "erros": _erros,
            })
            return
        if ruta == "/biblioteca":
            try:
                self.responder_json({"estado": "ok", "datos": leer_biblioteca()})
            except (OSError, ValueError) as error:
                self.error_json(500, f"Non se puido ler biblioteca.json: {error}")
            return
        self.error_json(404, "Ruta non atopada")

    def do_PUT(self):
        if urlparse(self.path).path != "/biblioteca":
            self.error_json(404, "Ruta non atopada")
            return
        try:
            longitud = int(self.headers.get("Content-Length", 0))
            if not 0 < longitud <= MAX_BYTES_BIBLIOTECA:
                raise ValueError("Corpo baleiro ou demasiado grande")
            datos = json.loads(self.rfile.read(longitud).decode("utf-8"))
            if not isinstance(datos, dict) or not isinstance(datos.get("textos"), list):
                raise ValueError("Falta a lista «textos»")
            for campo in ("eliminados", "vocabulario"):
                if campo in datos and not isinstance(datos[campo], dict):
                    raise ValueError(f"«{campo}» ten que ser un obxecto")
        except ValueError as error:
            self.error_json(400, str(error))
            return
        try:
            escribir_biblioteca(datos)
        except OSError as error:
            self.error_json(500, f"Non se puido gardar en «{CARPETA}»: {error}")
            return
        self.responder_json({"estado": "ok", "textos": len(datos["textos"])})

    def do_POST(self):
        if urlparse(self.path).path != "/analizar":
            self.error_json(404, "Ruta non atopada")
            return

        try:
            longitud = int(self.headers.get("Content-Length", 0))
        except ValueError:
            longitud = 0

        if longitud <= 0 or longitud > MAX_BYTES:
            self.error_json(400, "Corpo baleiro ou demasiado grande")
            return

        try:
            solicitud = json.loads(self.rfile.read(longitud).decode("utf-8"))
            texto = str(solicitud.get("texto", ""))
            idioma = str(solicitud.get("idioma", ""))
            forzar = bool(solicitud.get("forzar", False))
        except (ValueError, AttributeError):
            self.error_json(400, "JSON non válido")
            return

        try:
            palabras, desde_cache = analizar_con_cache(texto, idioma, forzar)
        except ValueError as error:
            self.error_json(400, str(error))
        except BaseException as error:
            if isinstance(error, (KeyboardInterrupt, SystemExit)):
                raise
            traceback.print_exc()
            if isinstance(error, EOFError):
                self.error_json(500, "CLTK pediu descargar o modelo e non puido preguntar. Executa unha vez en Python: "
                                     "from cltk import NLP; NLP(language_code='lat') e acepta a descarga (o mesmo con 'grc').")
            else:
                self.error_json(500, explicar_error(error))
        else:
            try:
                self.responder_json({"estado": "ok", "idioma": idioma, "cache": desde_cache, "palabras": palabras})
            except (TypeError, ValueError) as error:
                traceback.print_exc()
                self.error_json(500, f"Non se puido serializar a análise: {error}")


if __name__ == "__main__":
    analizador = argparse.ArgumentParser(description="Servidor local da biblioteca")
    analizador.add_argument("--carpeta", help="carpeta onde gardar biblioteca.json (p. ex. unha de Drive ou OneDrive)")
    analizador.add_argument("--abrir", action="store_true", help="abre a aplicación no navegador ao arrancar")
    argumentos = analizador.parse_args()
    if argumentos.carpeta:
        CARPETA = Path(argumentos.carpeta).expanduser().resolve()

    # Comproba que a carpeta existe e se pode escribir; se non, usa a carpeta «datos»
    try:
        CARPETA.mkdir(parents=True, exist_ok=True)
        prueba = CARPETA / ".prueba"
        prueba.write_text("ok", encoding="utf-8")
        prueba.unlink()
    except OSError as error:
        por_defecto = Path(__file__).resolve().with_name("datos")
        print(f"AVISO: non se pode escribir en «{CARPETA}» ({error}).")
        print(f"Úsase {por_defecto} no seu lugar. Revisa o valor de --carpeta (ten que ser unha ruta real do teu equipo).")
        CARPETA = por_defecto
        CARPETA.mkdir(parents=True, exist_ok=True)

    servidor = ThreadingHTTPServer((HOST, PUERTO), ServidorCLTK)

    # O latín cárgase en segundo plano para que a primeira análise non tarde tanto
    threading.Thread(target=precargar, args=("lat",), daemon=True).start()

    print(f"Biblioteca gardada en: {CARPETA / 'biblioteca.json'}")
    print(f"Servidor CLTK iniciado en http://{HOST}:{PUERTO}")
    print(f"Aplicación: http://{HOST}:{PUERTO}/index.html")
    if argumentos.abrir:
        threading.Timer(1, webbrowser.open, args=(f"http://{HOST}:{PUERTO}/index.html",)).start()
    print("Pulsa Ctrl+C para detelo.")

    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\nServidor detido.")
    finally:
        volcar_cache()
