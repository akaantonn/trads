
let textos = [];

try {
    const bruto = localStorage.getItem("bibliotecaTextos");
    try {
        const datos = JSON.parse(bruto);
        if (Array.isArray(datos)) {
            textos = datos.filter(function(t) { return t && typeof t === "object"; })
                .map(function(t) {
                    return Object.assign({ idioma: "latin", autor: "", obra: "", referencia: "", textoOriginal: "" }, t);
                });
        }
    } catch (e) {
        // Datos danados: gárdase unha copia para non perdelos ao seguinte gardado
        if (bruto) localStorage.setItem("bibliotecaTextos_corrupta", bruto);
    }
} catch (e) {
    // Sen acceso ao almacenamento
}

function simplificar(valor) {
    return String(valor || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
let textoActual = null;
let filtroIdioma = "todos";
let palabraSeleccionada = null;


// AUXILIARES PARA CREAR ELEMENTOS (sen innerHTML, así o contido nunca se interpreta como HTML)

function crearElemento(etiqueta, clase, texto) {

    const elemento = document.createElement(etiqueta);

    if (clase) {
        elemento.className = clase;
    }

    if (texto !== undefined) {
        elemento.textContent = texto;
    }

    return elemento;

}

function crearBoton(texto, clase, accion) {

    const boton = crearElemento("button", clase, texto);

    boton.type = "button";
    boton.addEventListener("click", accion);

    return boton;

}


// PANTALLAS (só unha visible á vez; a biblioteca recorda o desprazamento)

const PANTALLAS = ["pantallaBiblioteca", "pantallaNuevo", "pantallaImportar", "pantallaVocabulario", "pantallaPapelera", "pantallaTexto"];

let pantallaActual = "pantallaBiblioteca";
let desplazamientoBiblioteca = 0;

function mostrarPantalla(id) {

    if (id !== pantallaActual) {

        if (pantallaActual === "pantallaBiblioteca") {
            desplazamientoBiblioteca = window.scrollY;
        }

        PANTALLAS.forEach(function(p) {
            document.getElementById(p).classList.toggle("oculto", p !== id);
        });

        window.scrollTo({ top: id === "pantallaBiblioteca" ? desplazamientoBiblioteca : 0, behavior: "instant" });

        pantallaActual = id;

        // Accesibilidade: o foco pasa ao título da nova pantalla e actualízase o título da páxina
        const titulo = document.querySelector("#" + id + " h2");

        if (titulo) {
            titulo.setAttribute("tabindex", "-1");
            titulo.focus({ preventScroll: true });
            document.title = (titulo.textContent ? titulo.textContent + " · " : "") + "Biblioteca de Traducións Clásicas";
        }

    } else {

        document.getElementById(id).classList.remove("oculto");

    }

}


// AVISOS BREVES (substitúen aos alert nas confirmacións)

let temporizadorAviso = null;

// «accion» opcional: { etiqueta, funcion } (por exemplo, Desfacer)
function avisar(texto, accion) {

    let aviso = document.getElementById("aviso");

    if (!aviso) {
        aviso = crearElemento("div", "aviso");
        aviso.id = "aviso";
        aviso.setAttribute("role", "status");
        aviso.setAttribute("aria-live", "polite");
        document.body.appendChild(aviso);
    }

    aviso.replaceChildren(document.createTextNode(texto));
    aviso.classList.toggle("con-accion", Boolean(accion));

    if (accion) {
        aviso.appendChild(crearBoton(accion.etiqueta, "boton-aviso", function() {
            aviso.classList.remove("visible");
            accion.funcion();
        }));
    }

    aviso.classList.add("visible");

    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(function() { aviso.classList.remove("visible"); }, accion ? 8000 : 2800);

}


// ÁRBORE DA BIBLIOTECA: Autor → Obra → Libro → Capítulo → Fragmentos

const comparadorNatural = new Intl.Collator("gl", { numeric: true, sensitivity: "base" });

function obtenerNodo(contenedor, nombre) {

    if (!contenedor.has(nombre)) {
        contenedor.set(nombre, { nombre: nombre, hijos: new Map(), fragmentos: [] });
    }

    return contenedor.get(nombre);

}

function ordenarNumericamente(mapa) {

    const ordenados = Array.from(mapa.values()).sort(function(a, b) {
        return comparadorNatural.compare(a.nombre, b.nombre);
    });

    mapa.clear();
    ordenados.forEach(function(nodo) { mapa.set(nodo.nombre, nodo); });

}

function construirArbol(lista) {

    const autores = new Map();

    lista.forEach(function(texto) {

        const obra = obtenerNodo(obtenerNodo(autores, texto.autor).hijos, texto.obra);

        // «Libro 1 — Capítulo 2» (formato das obras importadas)
        const coincidencia = (texto.subdivision || "").match(/^Libro\s+(\d+)\s*[—–-]\s*Capítulo\s+(\d+)$/i);

        if (coincidencia) {
            const libro = obtenerNodo(obra.hijos, "Libro " + coincidencia[1]);
            obtenerNodo(libro.hijos, "Capítulo " + coincidencia[2]).fragmentos.push(texto);
        } else {
            // Textos creados a man, sen estrutura Libro — Capítulo
            obra.fragmentos.push(texto);
        }

    });

    autores.forEach(function(autor) {
        autor.hijos.forEach(function(obra) {
            ordenarNumericamente(obra.hijos);
            obra.hijos.forEach(function(libro) { ordenarNumericamente(libro.hijos); });
        });
    });

    return autores;

}

// Orde de lectura: o mesmo que se ve na biblioteca (fragmentos do nodo e despois os seus fillos)
function aplanarArbol(nodos) {

    const salida = [];

    nodos.forEach(function(nodo) {
        nodo.fragmentos.forEach(function(texto) { salida.push(texto); });
        aplanarArbol(nodo.hijos).forEach(function(texto) { salida.push(texto); });
    });

    return salida;

}


// IMPORTAR (ficheiros de obra, exportacións JSON e copias de seguridade)

function mostrarImportarObra() {

    mostrarPantalla("pantallaImportar");

}

function leerArchivoImportacion(evento) {

    const archivo = evento.target.files[0];

    if (!archivo) {
        return;
    }

    const lector = new FileReader();

    lector.onload = function() {

        try {

            const datos = JSON.parse(lector.result);

            const lista = Array.isArray(datos.textos) ? datos.textos
                : Array.isArray(datos.fragmentos) ? datos.fragmentos
                : null;

            if (!lista) {
                throw new Error("Falta a lista «textos» no ficheiro.");
            }

            if (lista.length === 0) {
                throw new Error("O ficheiro non contén textos.");
            }

            lista.forEach(function(texto, indice) {

                if (!texto || !texto.idioma || !texto.autor || !texto.obra || !texto.textoOriginal) {
                    throw new Error("Faltan datos obrigatorios no texto " + (indice + 1));
                }

                if (texto.idioma !== "griego" && texto.idioma !== "latin") {
                    throw new Error("Idioma non válido no texto " + (indice + 1));
                }

                if (typeof texto.autor !== "string" || typeof texto.obra !== "string" || typeof texto.textoOriginal !== "string") {
                    throw new Error("Autor, obra e texto deben ser texto no texto " + (indice + 1));
                }

            });

            importarTextos(lista, datos.vocabulario);

        } catch (error) {

            alert("Non se pode importar o ficheiro: " + error.message);

        }

    };

    lector.onerror = function() { alert("Non se puido ler o ficheiro."); };
    lector.readAsText(archivo);
    evento.target.value = "";   // permite volver a escoller o mesmo ficheiro

}

// Un ficheiro importado non é de confianza: só se aceitan os tipos e formas esperados
function sanearNotasPalabras(o) {

    const r = {};

    if (o && typeof o === "object" && !Array.isArray(o)) {
        Object.keys(o).forEach(function(k) { if (/^\d+$/.test(k) && typeof o[k] === "string") r[k] = o[k]; });
    }

    return r;

}

function sanearVocabularioImportado(o) {

    const r = {};

    Object.keys(o).forEach(function(k) {
        if (/^(griego|latin)\|/.test(k) && o[k] && typeof o[k] === "object" && !Array.isArray(o[k])) r[k] = o[k];
    });

    return r;

}

function sanearConexions(lista) {

    if (!Array.isArray(lista)) return [];

    return lista.filter(function(c) {
        return c && Array.isArray(c.o) && Array.isArray(c.t) &&
            c.o.every(function(o) { return o && Number.isInteger(o.i) && typeof o.x === "string"; }) &&
            c.t.every(function(t) { return t && Number.isInteger(t.i) && Number.isInteger(t.f) && typeof t.x === "string"; });
    });

}

function sanearVersiones(lista) {

    if (!Array.isArray(lista)) return [];

    return lista.filter(function(v) { return v && typeof v.t === "string" && typeof v.f === "string"; }).slice(-8);

}

function importarTextos(lista, vocabularioImportado) {

    const fechaActual = new Date().toISOString();

    if (vocabularioImportado && typeof vocabularioImportado === "object" && !Array.isArray(vocabularioImportado)) {
        vocabulario = fusionarVocabulario(vocabulario, sanearVocabularioImportado(vocabularioImportado));
        guardarVocabulario();
    }

    const textosNuevos = lista.filter(function(texto) {

        return !textos.some(function(existente) {

            return (
                existente.idioma === texto.idioma &&
                existente.autor === texto.autor &&
                existente.obra === texto.obra &&
                (existente.subdivision || "") === (texto.subdivision || "") &&
                (existente.referencia || "") === (texto.referencia || "") &&
                existente.textoOriginal === texto.textoOriginal
            );

        });

    });

    if (textosNuevos.length === 0) {

        avisar("Todos os textos deste ficheiro xa existen na biblioteca.");
        return;

    }

    textosNuevos.forEach(function(texto, indice) {

        const nuevoTexto = {

            id: Date.now().toString() + "-" + indice + "-" + Math.random().toString(36).slice(2),

            idioma: texto.idioma,
            coleccion: texto.coleccion || "",
            autor: texto.autor,
            obra: texto.obra,
            subdivision: texto.subdivision || "",
            referencia: texto.referencia || "",
            textoOriginal: texto.textoOriginal,

            // Se o ficheiro é unha exportación ou copia, consérvase o traballo feito
            traduccion: typeof texto.traduccion === "string" ? texto.traduccion : "",
            notas: "",
            notaFragmento: typeof texto.notaFragmento === "string" ? texto.notaFragmento : "",
            notasPalabras: sanearNotasPalabras(texto.notasPalabras),
            versiones: sanearVersiones(texto.versiones),
            conexions: sanearConexions(texto.conexions),

            fechaCreacion: fechaActual,
            fechaModificacion: fechaActual

        };

        if (ETIQUETAS_ESTADO[texto.estado]) {
            nuevoTexto.estado = texto.estado;
        }

        if (Array.isArray(texto.vocabulario) && texto.vocabHuella) {
            nuevoTexto.vocabulario = texto.vocabulario;
            nuevoTexto.vocabHuella = texto.vocabHuella;
        }

        textos.push(nuevoTexto);

    });

    guardarBiblioteca();

    mostrarBiblioteca();

    avisar("Importación completada: " + textosNuevos.length +
        (textosNuevos.length === 1 ? " texto engadido." : " textos engadidos."));

}

function exportarCopiaCompleta() {

    guardarTraduccionPendiente();

    if (textos.length === 0) {
        avisar("Aínda non hai nada que copiar.");
        return;
    }

    descargarArchivo(
        "biblioteca-" + new Date().toISOString().slice(0, 10) + ".json",
        "application/json",
        JSON.stringify({ version: 1, fecha: new Date().toISOString(), textos: textos, vocabulario: vocabulario }, null, 1)
    );

    try { localStorage.setItem("bibliotecaUltimaCopia", String(Date.now())); } catch (e) {}

    avisar("Copia de seguridade descargada.");

}

function mostrarRecientes() {

    const contenedor = document.getElementById("listaRecientes");

    if (!contenedor) {
        return;
    }

    contenedor.innerHTML = "";

    document.getElementById("recientes").classList.toggle("oculto", textos.length === 0);

    const recientes = textos
        .slice()
        .sort(function(a, b) {

            const fechaA = new Date(
                a.fechaModificacion || a.fechaCreacion || 0
            );

            const fechaB = new Date(
                b.fechaModificacion || b.fechaCreacion || 0
            );

            return fechaB - fechaA;

        })
        .slice(0, 5);

    recientes.forEach(function(texto) {

        const tarjeta = crearElemento("div", "tarjeta-reciente " + texto.idioma);

        const informacion = crearElemento("div", "informacion-reciente");

        const titulo = crearElemento(
            "strong",
            "",
            texto.referencia || texto.obra
        );

        const descripcion = crearElemento(
            "span",
            "",
            (texto.autor || "") +
            " · " +
            (texto.obra || "")
        );

        informacion.appendChild(titulo);
        informacion.appendChild(descripcion);

        tarjeta.appendChild(informacion);
        tarjeta.classList.add("elemento-clicable");
        tarjeta.tabIndex = 0;
        tarjeta.setAttribute("role", "button");
        tarjeta.setAttribute("aria-label", "Abrir " + (texto.referencia || texto.obra));
        tarjeta.addEventListener("click", function() { abrirTexto(texto.id); });
        tarjeta.addEventListener("keydown", function(evento) {
            if (evento.key === "Enter" || evento.key === " ") {
                evento.preventDefault();
                abrirTexto(texto.id);
            }
        });
        contenedor.appendChild(tarjeta);

    });

}


// MOSTRAR LA BIBLIOTECA

const gruposAbiertos = new Set();   // rutas dos grupos despregados: sobreviven aos repintados

// Busca polo lema (forma de dicionario): «amo» atopa os textos onde aparece amat, amabam…
function coincidePorLema(texto, busqueda) {

    if (!busqueda || !Array.isArray(texto.vocabulario)) return false;

    return texto.vocabulario.some(function(e) { return simplificar(e.l) === busqueda; });

}

function textoCoincide(texto, busqueda) {

    return textoCoincideDirecto(texto, busqueda) || coincidePorLema(texto, busqueda);

}

function textoCoincideDirecto(texto, busqueda) {

    if (!busqueda) {
        return true;
    }

    return [
        texto.autor, texto.obra, texto.referencia, texto.subdivision, texto.coleccion,
        texto.textoOriginal, texto.traduccion, texto.notaFragmento,
        Object.values(texto.notasPalabras || {}).join(" ")
    ].some(function(campo) {
        return simplificar(campo).includes(busqueda);
    });

}

function textosFiltrados() {

    const busqueda = simplificar(document.getElementById("buscador").value.trim());
    const estadoPedido = document.getElementById("filtroEstado").value;

    return textos.filter(function(texto) {

        return textoCoincide(texto, busqueda) &&
            (filtroIdioma === "todos" || texto.idioma === filtroIdioma) &&
            (estadoPedido === "todos" || estadoDe(texto) === estadoPedido);

    });

}

function mostrarBiblioteca() {

    guardarTraduccionPendiente();
    mostrarRecientes();
    mostrarResumenProgreso();
    actualizarBotonContinuar();
    actualizarBotonPapelera();
    pintarBiblioteca();

    mostrarPantalla("pantallaBiblioteca");

}

function crearVacio() {

    const hayTextos = textos.length > 0;
    const vacio = crearElemento("div", "vacio");

    vacio.appendChild(crearElemento("div", "vacio-marca", "λ"));
    vacio.appendChild(crearElemento("h3", "", hayTextos ? "Non hai resultados" : "Aínda non hai textos"));
    vacio.appendChild(crearElemento("p", "", hayTextos
        ? "Proba con outra busca ou cambia os filtros."
        : "Crea o teu primeiro texto ou importa unha obra completa."));

    if (!hayTextos) {
        const acciones = crearElemento("div", "acciones-vacio");
        acciones.appendChild(crearBoton("Novo texto", "", function() { mostrarNuevoTexto(); }));
        acciones.appendChild(crearBoton("Importar obra", "boton-secundario", function() { mostrarImportarObra(); }));
        vacio.appendChild(acciones);
    }

    return vacio;

}

function pintarBiblioteca() {

    const biblioteca = document.getElementById("biblioteca");
    const filtrados = textosFiltrados();
    const buscando = document.getElementById("buscador").value.trim() !== "";

    biblioteca.replaceChildren();

    if (filtrados.length === 0) {
        biblioteca.appendChild(crearVacio());
        return;
    }

    mostrarNivel(construirArbol(filtrados), biblioteca, 0, "", buscando);

}

// Apartado desplegable (details) que recorda se estaba aberto
function crearGrupo(nombre, clase, ruta, abiertoPorBusca) {

    // Os botóns de acción van ao lado do <details>, non dentro do <summary> (un botón dentro doutro
    // control non se le ben cos lectores de pantalla). Superpóñense por CSS á dereita do título.
    const envoltorio = crearElemento("div", "envoltorio-grupo");
    const grupo = document.createElement("details");
    grupo.className = "grupo-biblioteca " + clase;
    grupo.open = abiertoPorBusca || gruposAbiertos.has(ruta);

    const titulo = document.createElement("summary");
    const etiqueta = crearElemento("span", "nombre-grupo", nombre);
    const contenido = crearElemento("div", "contenido-grupo");

    titulo.appendChild(etiqueta);
    grupo.appendChild(titulo);
    grupo.appendChild(contenido);
    envoltorio.appendChild(grupo);

    if (!abiertoPorBusca) {
        grupo.addEventListener("toggle", function() {
            if (grupo.open) gruposAbiertos.add(ruta);
            else gruposAbiertos.delete(ruta);
        });
    }

    return { envoltorio: envoltorio, grupo: grupo, titulo: titulo, etiqueta: etiqueta, contenido: contenido };

}

function crearTarjetaFragmento(texto) {

    const tarjeta = crearElemento("div", "tarjeta " + texto.idioma);
    const estado = estadoDe(texto);

    tarjeta.appendChild(crearElemento("span", "etiqueta", texto.idioma === "griego" ? "Grego" : "Latín"));
    tarjeta.appendChild(crearElemento("span", "insignia-estado estado-" + estado, ETIQUETAS_ESTADO[estado]));

    const busca = simplificar(document.getElementById("buscador").value.trim());

    if (busca && !textoCoincideDirecto(texto, busca) && coincidePorLema(texto, busca)) {
        tarjeta.appendChild(crearElemento("span", "etiqueta-lema", "Coincide polo lema"));
    }
    tarjeta.appendChild(crearElemento("h3", "", texto.obra));
    tarjeta.appendChild(crearElemento("div", "autor", texto.autor));

    const lugar = [texto.subdivision, texto.referencia].filter(Boolean).join(", ");

    if (lugar) {
        tarjeta.appendChild(crearElemento("div", "detalle", lugar));
    }

    const acciones = crearElemento("div", "acciones");

    acciones.appendChild(crearBoton("Abrir", "", function() {
        abrirTexto(texto.id);
    }));

    acciones.appendChild(crearBoton("Eliminar", "boton-peligro", function() {
        eliminarTextoDesdeBiblioteca(texto.id);
    }));

    tarjeta.appendChild(acciones);

    return tarjeta;

}

const TIPOS_NIVEL = ["Autor", "Obra", "Libro", "Capítulo"];
const CLASES_NIVEL = ["grupo-autor", "grupo-obra", "grupo-libro", "grupo-capitulo"];

function mostrarNivel(nodos, contenedor, profundidad, rutaPadre, abiertoPorBusca) {

    const nivel = Math.min(profundidad, TIPOS_NIVEL.length - 1);
    const tipo = TIPOS_NIVEL[nivel];

    nodos.forEach(function(nodo) {

        const ruta = rutaPadre + "\u0001" + nodo.nombre;
        const apartado = crearGrupo(nodo.nombre, CLASES_NIVEL[nivel], ruta, abiertoPorBusca);
        const cuenta = contarEstados(nodo);
        const idiomas = new Set(aplanarArbol(new Map([[nodo.nombre, nodo]])).map(function(t) { return t.idioma; }));

        if (idiomas.size === 1) {
            const idioma = Array.from(idiomas)[0];
            apartado.grupo.dataset.idioma = idioma;

            if (nivel <= 1) {
                apartado.etiqueta.appendChild(crearElemento("small", "etiqueta-idioma " + idioma, idioma === "griego" ? "Grego" : "Latín"));
            }
        }

        apartado.etiqueta.appendChild(crearElemento(
            "small", "contador-grupo",
            cuenta.total + (cuenta.total === 1 ? " texto" : " textos")
        ));

        const botonExportar = crearBoton("Exportar", "boton-exportar", function(evento) {
            evento.preventDefault();
            evento.stopPropagation();
            exportarNodo(nodo, tipo);
        });
        botonExportar.setAttribute("aria-label", "Exportar " + tipo.toLowerCase() + ": " + nodo.nombre);

        const botonEliminar = crearBoton("Eliminar", "boton-peligro boton-eliminar-grupo", function(evento) {
            evento.preventDefault();
            evento.stopPropagation();
            eliminarNodo(nodo, tipo);
        });
        botonEliminar.setAttribute("aria-label", "Eliminar " + tipo.toLowerCase() + ": " + nodo.nombre);

        apartado.titulo.appendChild(crearProgreso(cuenta));

        const accionesGrupo = crearElemento("div", "acciones-grupo");

        accionesGrupo.appendChild(botonExportar);
        accionesGrupo.appendChild(botonEliminar);
        apartado.envoltorio.insertBefore(accionesGrupo, apartado.grupo);

        nodo.fragmentos.forEach(function(texto) {
            apartado.contenido.appendChild(crearTarjetaFragmento(texto));
        });

        if (nodo.hijos.size > 0) {
            mostrarNivel(nodo.hijos, apartado.contenido, profundidad + 1, ruta, abiertoPorBusca);
        }

        contenedor.appendChild(apartado.envoltorio);

    });

}

// FILTRAR POR IDIOMA

function cambiarFiltroIdioma(idioma) {

    filtroIdioma = idioma;

    document.querySelectorAll(".filtros button").forEach(function(boton) {
        boton.setAttribute("aria-pressed", String(boton.dataset.idioma === idioma));
    });

    mostrarBiblioteca();

}


// MOSTRAR O FORMULARIO DE NOVO TEXTO

function mostrarNuevoTexto() {

    mostrarPantalla("pantallaNuevo");
    document.getElementById("autor").focus();

}


// CREAR UN TEXTO


function crearTexto() {

    const idioma = document.getElementById("idioma").value;
    const coleccion = document.getElementById("coleccion").value.trim();
    const autor = document.getElementById("autor").value.trim();
    const obra = document.getElementById("obra").value.trim();
    const subdivision = document.getElementById("subdivision").value.trim();
    const referencia = document.getElementById("referencia").value.trim();
    const textoOriginal = document.getElementById("textoOriginal").value.trim();

    if (!autor || !obra || !textoOriginal) {

        alert("Introduce polo menos o autor, a obra e o texto orixinal.");
        return;

    }

    const nuevoTexto = {

        id: Date.now().toString(),
        idioma: idioma,
        coleccion: coleccion,
        autor: autor,
        obra: obra,
        subdivision: subdivision,
        referencia: referencia,
        textoOriginal: textoOriginal,
        traduccion: "",
        notas: "",
        notasPalabras: {},
        fechaCreacion: new Date().toISOString(),
        fechaModificacion: new Date().toISOString()

    };

    textos.push(nuevoTexto);

    guardarBiblioteca();

    document.getElementById("coleccion").value = "";
    document.getElementById("autor").value = "";
    document.getElementById("obra").value = "";
    document.getElementById("subdivision").value = "";
    document.getElementById("referencia").value = "";
    document.getElementById("textoOriginal").value = "";

    abrirTexto(nuevoTexto.id);

}


// ABRIR UN TEXTO

function abrirTexto(id) {

    guardarTraduccionPendiente();

    const texto = textos.find(function(t) {
        return t.id === id;
    });

    if (!texto) {
        return;
    }

    textoActual = texto;
    idCamposCargados = null;
    reiniciarConectar();

    // Preparar el espacio de notas de palabras
    if (!textoActual.notasPalabras) {
        textoActual.notasPalabras = {};
    }

    palabraSeleccionada = null;
    prepararAnalisis();

    document.getElementById("estadoTexto").value = textoActual.estado || "pendiente";

    try { localStorage.setItem("bibliotecaUltimo", textoActual.id); } catch (e) {}

    if (!analisisActual && Date.now() - ultimoFalloServidor > 20000) {
        analizarTextoActual(true);
    }

    mostrarPantalla("pantallaTexto");

    document.getElementById("pantallaTexto").dataset.idioma = texto.idioma;
    document.getElementById("tituloTexto").textContent = texto.obra;
    document.title = texto.obra + " · Biblioteca de Traducións Clásicas";

    const idioma =
        texto.idioma === "griego" ? "Grego" : "Latín";

    document.getElementById("informacionTexto").textContent =
        [idioma, texto.coleccion, texto.autor, texto.subdivision, texto.referencia]
            .filter(Boolean)
            .join(" · ");

    // Primeiro os campos de edición, despois o resto: se algo falla ao pintar o texto,
    // a tradución e as notas non se perden nin se sobrescriben con campos baleiros
    document.getElementById("campoTraduccion").value =
        texto.traduccion || "";

    document.getElementById("notaFragmento").value = texto.notaFragmento || "";

    idCamposCargados = texto.id;

    try {
        renderizarTextoOriginal(texto);
    } catch (error) {
        console.error(error);
        avisar("Houbo un erro ao mostrar o texto orixinal. A túa tradución non se tocou.");
    }

    if (modoEstudo) renderizarTraduccionLectura();

    actualizarNavegacionFragmentos();
    pintarHistorial();

    cerrarEditorNota(false);
    document.getElementById("campoNotaPalabra").value = "";

}

// NAVEGACIÓN ENTRE FRAGMENTOS (na orde de lectura da propia obra)

function listaNavegacion() {

    if (!textoActual) {
        return [];
    }

    return aplanarArbol(construirArbol(textos)).filter(function(texto) {
        return texto.autor === textoActual.autor && texto.obra === textoActual.obra;
    });

}

function actualizarNavegacionFragmentos() {

    if (!textoActual) {
        return;
    }

    const lista = listaNavegacion();
    const indice = lista.findIndex(function(texto) { return texto.id === textoActual.id; });
    const lugar = [textoActual.subdivision, textoActual.referencia].filter(Boolean).join(" · ");

    document.getElementById("posicionFragmento").textContent =
        (lugar ? lugar + " · " : "") + (indice + 1) + " de " + lista.length;

    document.getElementById("botonAnterior").disabled = indice <= 0;
    document.getElementById("botonSeguinte").disabled = indice === -1 || indice >= lista.length - 1;

}

function moverFragmento(paso) {

    const lista = listaNavegacion();
    const indice = lista.findIndex(function(texto) { return textoActual && texto.id === textoActual.id; });

    if (indice !== -1 && lista[indice + paso]) {
        abrirTexto(lista[indice + paso].id);
    }

}

function irAlFragmentoAnterior() {

    moverFragmento(-1);

}

function irAlFragmentoSiguiente() {

    moverFragmento(1);

}

// MOSTRAR LAS PALABRAS DEL TEXTO ORIGINAL

function renderizarTextoOriginal(texto) {

    const contenedor = document.getElementById("textoOriginalMostrar");

    contenedor.replaceChildren();

    if (!texto.notasPalabras) {
        texto.notasPalabras = {};
    }

    const contenido = texto.textoOriginal || "";

    // Idioma real do texto: os lectores de pantalla e o navegador pronuncian e axustan as letras correctamente
    contenedor.lang = texto.idioma === "griego" ? "grc" : "la";

    const expresion = /[\p{L}\p{M}]+(?:[’'][\p{L}\p{M}]+)*/gu;

    let linea = null;
    let posicion = 0;
    let indicePalabra = 0;
    let coincidencia;

    function nuevaLinea() {
        linea = crearElemento("div", "linea");
        const numero = crearElemento("span", "num-linea");
        numero.setAttribute("aria-hidden", "true");
        linea.appendChild(numero);
        linea.appendChild(crearElemento("span", "contido-linea"));
        contenedor.appendChild(linea);
    }

    function engadir(nodo) {
        if (!linea) nuevaLinea();
        linea.lastChild.appendChild(nodo);
    }

    function engadirTexto(fragmento) {
        fragmento.split("\n").forEach(function(parte, i) {
            if (i > 0) nuevaLinea();
            if (parte) engadir(document.createTextNode(parte));
        });
    }

    while ((coincidencia = expresion.exec(contenido)) !== null) {

        engadirTexto(contenido.slice(posicion, coincidencia.index));

        const palabra = document.createElement("span");

        palabra.className = "palabra";
        palabra.textContent = coincidencia[0];
        palabra.dataset.indice = indicePalabra;

        const nota = texto.notasPalabras[indicePalabra];

        if (nota) {
            palabra.classList.add("palabra-con-nota");
            palabra.dataset.nota = nota;
        }

        palabra.setAttribute("role", "button");
        palabra.setAttribute("aria-haspopup", "true");
        // Un só punto de tabulación para todo o texto; dentro móvese coas frechas
        palabra.setAttribute("tabindex", indicePalabra === 0 ? "0" : "-1");
        palabra.setAttribute("aria-label", etiquetaPalabra(palabra));

        engadir(palabra);

        posicion = expresion.lastIndex;
        indicePalabra++;

    }

    engadirTexto(contenido.slice(posicion));

    // Numérase só as liñas con palabras: serve de referencia ao traducir
    let numero = 0;

    contenedor.querySelectorAll(".linea").forEach(function(l) {
        if (l.querySelector(".palabra")) l.firstChild.textContent = ++numero;
        else l.classList.add("linea-vacia");
    });

    aplicarColoresGramatica();

}


// EDITOR FLOTANTE DE NOTAS (rato, teclado e pantallas táctiles)

const contenedorPalabras = document.getElementById("textoOriginalMostrar");
const editorNota = document.getElementById("editorNotaPalabra");

let temporizadorNota = null;
let temporizadorOcultarNota = null;
let editorFixado = false;   // true cando se abriu con clic/teclado ou se está escribindo


function palabraPorIndice(indice) {

    return contenedorPalabras.querySelector('.palabra[data-indice="' + indice + '"]');

}


// Texto que len os lectores de pantalla: palabra + categoría gramatical + se ten nota
function etiquetaPalabra(palabra) {

    const partes = [palabra.textContent];
    const cat = palabra.dataset.cat;

    if (cat && coloresActivos) partes.push(nomeCor(cat));
    if (palabra.dataset.forma && coloresActivos) partes.push(palabra.dataset.forma);
    if (palabra.dataset.rexe) partes.push("rexe " + nomeCaso(palabra.dataset.rexe).toLowerCase());
    if (palabra.dataset.nota) partes.push("con nota");

    return partes.join(", ");

}

function moverFocoPalabra(actual, destino) {

    if (!destino) return;

    actual.setAttribute("tabindex", "-1");
    destino.setAttribute("tabindex", "0");
    destino.focus();

}

// Frechas, Inicio e Fin para recorrer as palabras sen pasar por centos de tabulacións
contenedorPalabras.addEventListener("keydown", function(evento) {

    const palabra = evento.target.closest && evento.target.closest(".palabra");

    if (!palabra || evento.ctrlKey || evento.altKey || evento.metaKey || evento.shiftKey) return;

    const todas = Array.from(contenedorPalabras.querySelectorAll(".palabra"));
    const i = todas.indexOf(palabra);
    let destino = null;

    if (evento.key === "ArrowRight") destino = todas[i + 1];
    else if (evento.key === "ArrowLeft") destino = todas[i - 1];
    else if (evento.key === "Home") destino = todas[0];
    else if (evento.key === "End") destino = todas[todas.length - 1];
    else return;

    evento.preventDefault();
    evento.stopPropagation();
    moverFocoPalabra(palabra, destino);

});

// Co teclado tamén se ve o cadro coa análise (antes só aparecía ao pasar o rato)
contenedorPalabras.addEventListener("focusin", function(evento) {

    const palabra = evento.target.closest && evento.target.closest(".palabra");

    if (!palabra) return;

    contenedorPalabras.querySelectorAll('.palabra[tabindex="0"]').forEach(function(p) {
        if (p !== palabra) p.setAttribute("tabindex", "-1");
    });
    palabra.setAttribute("tabindex", "0");

    if (!editorFixado) mostrarTooltip(palabra);

});

contenedorPalabras.addEventListener("focusout", function() { ocultarTooltip(); });

// WCAG 1.4.13: o cadro flotante pódese pechar con Esc sen mover o foco
document.addEventListener("keydown", function(evento) {
    if (evento.key === "Escape" && tooltipNota.style.display !== "none") ocultarTooltip();
});

function posicionarEditorNota(palabra) {

    const caja = palabra.getBoundingClientRect();
    const ancho = editorNota.offsetWidth;
    const alto = editorNota.offsetHeight;
    const margen = 12;

    let izquierda = Math.max(15, Math.min(caja.left, window.innerWidth - ancho - 15));
    let arriba = caja.bottom + 4;

    if (arriba + alto > window.innerHeight - 10) {

        const encima = caja.top - alto - 4;

        if (encima >= 10) {

            arriba = encima;

        } else if (window.innerWidth > 700) {

            // Non cabe nin debaixo nin enriba: ao lado da palabra, para non tapala
            // (por fóra da columna do texto orixinal, así non tapa o que estás lendo)
            const columna = palabra.closest(".columna");

            izquierda = (columna ? columna.getBoundingClientRect().right : caja.right) + margen;

            if (izquierda + ancho > window.innerWidth - 15) {
                izquierda = Math.max(15, caja.left - ancho - margen);
            }

            arriba = Math.max(10, Math.min(caja.top - 40, window.innerHeight - alto - 10));

        } else {

            arriba = Math.max(10, window.innerHeight - alto - 10);

        }

    }

    editorNota.style.left = izquierda + "px";
    editorNota.style.top = arriba + "px";

}


function abrirEditorNota(palabra, fixar, enfocar) {

    if (!textoActual) {
        return;
    }

    palabraSeleccionada = Number(palabra.dataset.indice);

    document.getElementById("tituloNotaPalabra").textContent =
        "Nota de: " + palabra.textContent;

    mostrarAnalisisEnEditor(palabraSeleccionada);
    actualizarEnlacesDiccionario(palabra, palabraSeleccionada);
    prepararVocabRapido(palabra, palabraSeleccionada);

    document.getElementById("campoNotaPalabra").value =
        textoActual.notasPalabras[palabraSeleccionada] || "";

    ocultarTooltip();

    editorNota.classList.remove("oculto");
    autoajustarCampoNota();
    posicionarEditorNota(palabra);

    marcarPalabraActiva(fixar ? palabra : null);

    if (fixar) {
        editorFixado = true;

        // Co rato o foco queda na palabra (sen cursor de escritura); co teclado vai ao campo
        if (enfocar) document.getElementById("campoNotaPalabra").focus();
    }

}


function marcarPalabraActiva(palabra) {

    contenedorPalabras.querySelectorAll(".palabra-activa").forEach(function(p) {
        p.classList.remove("palabra-activa");
    });

    if (palabra) palabra.classList.add("palabra-activa");

    marcarMismoLema(palabra);
    marcarConcordancia(palabra);

}


function cerrarEditorNota(devolverFoco) {

    const indice = palabraSeleccionada;
    const estabaFixado = editorFixado;

    clearTimeout(temporizadorNota);
    clearTimeout(temporizadorOcultarNota);

    editorNota.classList.add("oculto");
    editorFixado = false;
    palabraSeleccionada = null;
    marcarPalabraActiva(null);

    // Devolver o foco á palabra para poder seguir co teclado
    if (devolverFoco && estabaFixado && indice !== null) {
        const palabra = palabraPorIndice(indice);

        if (palabra) {
            palabra.focus();
        }
    }

}


// Que o campo creza co texto (ata un límite) para que a nota longa non quede cortada
function autoajustarCampoNota() {

    const campo = document.getElementById("campoNotaPalabra");

    campo.style.height = "auto";
    campo.style.height =
        Math.min(campo.scrollHeight + 2, Math.round(window.innerHeight * 0.45)) + "px";

}

document.getElementById("campoNotaPalabra").addEventListener("input", function() {

    autoajustarCampoNota();

    if (palabraSeleccionada !== null) {
        const palabra = palabraPorIndice(palabraSeleccionada);

        if (palabra) {
            posicionarEditorNota(palabra);
        }
    }

});

window.addEventListener("resize", function() {

    if (editorNota.classList.contains("oculto") || palabraSeleccionada === null) return;

    const palabra = palabraPorIndice(palabraSeleccionada);

    if (palabra) {
        autoajustarCampoNota();
        posicionarEditorNota(palabra);
    }

});


// CUADRO COa NOTA AO PASAR O CURSOR (sempre dentro da pantalla)

const tooltipNota = crearElemento("div", "tooltip-nota");
tooltipNota.style.display = "none";
document.body.appendChild(tooltipNota);

function mostrarTooltip(palabra) {

    const contido = textoTooltip(palabra);

    if (!contido) return;

    tooltipNota.textContent = contido;
    tooltipNota.style.display = "block";

    const caja = palabra.getBoundingClientRect();
    const ancho = tooltipNota.offsetWidth;
    const alto = tooltipNota.offsetHeight;

    const izquierda = Math.max(
        10,
        Math.min(caja.left + caja.width / 2 - ancho / 2, window.innerWidth - ancho - 10)
    );

    // Enriba da palabra se cabe; se non, debaixo
    let arriba = caja.top - alto - 8;

    if (arriba < 10) {
        arriba = Math.min(caja.bottom + 8, window.innerHeight - alto - 10);
    }

    tooltipNota.style.left = izquierda + "px";
    tooltipNota.style.top = Math.max(10, arriba) + "px";

}

function ocultarTooltip() {

    tooltipNota.style.display = "none";

}


// Con rato: abrir tras 3 segundos sobre a palabra
contenedorPalabras.addEventListener("mouseover", function(evento) {

    if (modoConectar) return;

    const palabra = evento.target.closest(".palabra");

    if (!palabra || editorFixado) return;

    clearTimeout(temporizadorNota);
    clearTimeout(temporizadorOcultarNota);

    editorNota.classList.add("oculto");

    mostrarTooltip(palabra);

    temporizadorNota = setTimeout(function() {
        abrirEditorNota(palabra, false);
    }, 3000);

});

contenedorPalabras.addEventListener("mouseout", function(evento) {

    const palabra = evento.target.closest(".palabra");

    if (palabra) {
        ocultarTooltip();
    }

    if (!palabra || editorFixado) return;

    if (editorNota.contains(evento.relatedTarget)) return;

    clearTimeout(temporizadorNota);

    temporizadorOcultarNota = setTimeout(function() {
        if (!editorFixado) {
            editorNota.classList.add("oculto");
        }
    }, 250);

});

// Clic ou toque: abrir ao instante e deixar o editor fixo
contenedorPalabras.addEventListener("click", function(evento) {

    const palabra = evento.target.closest(".palabra");

    if (!palabra) return;

    clearTimeout(temporizadorNota);
    abrirEditorNota(palabra, true, false);

});

// Teclado: Intro ou espazo sobre unha palabra
contenedorPalabras.addEventListener("keydown", function(evento) {

    if (evento.key === "Enter" || evento.key === " ") {

        const palabra = evento.target.closest(".palabra");

        if (palabra) {
            evento.preventDefault();
            abrirEditorNota(palabra, true, true);
        }

    }

});

// Navegación entre fragmentos con las flechas del teclado

document.addEventListener("keydown", function(evento) {

    if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight") {
        return;
    }

    // No cambiar de fragmento mientras se escribe una traducción
    // o una nota.
    const elemento = evento.target;

    if (
        document.getElementById("pantallaTexto").classList.contains("oculto") ||
        evento.ctrlKey || evento.altKey || evento.metaKey || evento.shiftKey ||
        elemento.tagName === "SELECT" || elemento.closest(".palabra")
    ) {
        return;
    }

    if (
        elemento.tagName === "TEXTAREA" ||
        elemento.tagName === "INPUT"
    ) {
        return;
    }

    if (evento.key === "ArrowLeft") {
        irAlFragmentoAnterior();
    }

    if (evento.key === "ArrowRight") {
        irAlFragmentoSiguiente();
    }

});

// Manter aberto o editor ao entrar nel; fixalo ao escribir
editorNota.addEventListener("mouseenter", function() {
    clearTimeout(temporizadorOcultarNota);
});

editorNota.addEventListener("mouseleave", function(evento) {

    if (editorFixado || contenedorPalabras.contains(evento.relatedTarget)) return;

    temporizadorOcultarNota = setTimeout(function() {
        editorNota.classList.add("oculto");
    }, 250);

});

editorNota.addEventListener("focusin", function() {
    editorFixado = true;
});

// Escape pecha o editor
editorNota.addEventListener("keydown", function(evento) {

    if (evento.key === "Escape") {
        evento.preventDefault();
        cerrarEditorNota(true);
    }

});

// Ao facer scroll, recolocar o editor fixo ou pechar o temporal
window.addEventListener("scroll", function() {

    ocultarTooltip();

    if (editorNota.classList.contains("oculto")) return;

    if (editorFixado && palabraSeleccionada !== null) {
        const palabra = palabraPorIndice(palabraSeleccionada);

        if (palabra) {
            posicionarEditorNota(palabra);
        }
    } else {
        editorNota.classList.add("oculto");
    }

}, { passive: true });


// GUARDAR LA NOTA DE UNA PALABRA

function guardarNotaPalabra() {

    if (modoEstudo) return;

    if (!textoActual || palabraSeleccionada === null) {
        return;
    }

    const nota = document.getElementById("campoNotaPalabra").value.trim();

    if (nota) {
        textoActual.notasPalabras[palabraSeleccionada] = nota;
    } else {
        delete textoActual.notasPalabras[palabraSeleccionada];
    }

    textoActual.fechaModificacion = new Date().toISOString();

    guardarBiblioteca();

    renderizarTextoOriginal(textoActual);

    cerrarEditorNota(true);

    avisar("A nota da palabra foi gardada.");

}


// CANCELAR LA EDICIÓN DE UNA NOTA

function cancelarNotaPalabra() {

    cerrarEditorNota(true);

}


// ELIMINAR LA NOTA DE UNA PALABRA

function eliminarNotaPalabra() {

    if (modoEstudo) return;

    if (!textoActual || palabraSeleccionada === null) {
        return;
    }

    delete textoActual.notasPalabras[palabraSeleccionada];

    textoActual.fechaModificacion = new Date().toISOString();

    guardarBiblioteca();

    renderizarTextoOriginal(textoActual);

    cerrarEditorNota(true);

    avisar("A nota da palabra foi eliminada.");

}


// GUARDAR LA TRADUCCIÓN

function guardarCambios() {

    if (modoEstudo) return;

    if (!textoActual) {
        return;
    }

    aplicarCambiosFragmento(
        document.getElementById("campoTraduccion").value,
        document.getElementById("notaFragmento").value
    );

    avisar("A tradución foi gardada."
    );

}

function exportarNodo(nodo, tipo) {

    const fragmentos = [];

    function recogerFragmentos(actual) {

        actual.fragmentos.forEach(function(texto) {
            fragmentos.push(texto);
        });

        actual.hijos.forEach(function(hijo) {
            recogerFragmentos(hijo);
        });

    }

    recogerFragmentos(nodo);

    if (fragmentos.length === 0) {
        alert("Non hai fragmentos para exportar.");
        return;
    }

    if (document.getElementById("formatoExportacion").value === "pdf") {
        exportarPdf(fragmentos, nodo);
        return;
    }

    let contenido = "";

    const primerFragmento = fragmentos[0];

    contenido += (primerFragmento.autor || "") + "\n";
    contenido += (primerFragmento.obra || "") + "\n\n";

    contenido += tipo.toUpperCase() + ": ";
    contenido += nodo.nombre.toUpperCase() + "\n\n";

    fragmentos.forEach(function(texto) {

        contenido += (texto.referencia || "") + "\n\n";

        contenido += "Texto orixinal:\n";
        contenido += (texto.textoOriginal || "") + "\n\n";

        contenido += "A miña tradución:\n";
        contenido += (texto.traduccion || "") + "\n\n";

        contenido += "----------------------------------------\n\n";

    });

    const salida = prepararExportacion(contenido, fragmentos, nodo);

    const archivo = new Blob(
        [salida.contenido],
        { type: salida.mime + ";charset=utf-8" }
    );

    const enlace = document.createElement("a");

    enlace.href = URL.createObjectURL(archivo);

    enlace.download =
        (simplificar(nodo.nombre).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "exportacion") +
        "." + salida.ext;

    // Hai que engadir o enlace ao documento e non liberar a URL ata que remate o clic
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();

    setTimeout(function() { URL.revokeObjectURL(enlace.href); }, 1000);

}


// ELIMINAR UN TEXTO DESDE EL LECTOR

function eliminarTexto() {

    if (modoEstudo) return;

    if (!textoActual) {
        return;
    }

    if (!confirm("Seguro que queres eliminar este texto e a túa tradución?\n\nPoderás recuperalo desde a Papeleira.")) {
        return;
    }

    eliminarTextos([textoActual.id], "Texto eliminado.");

}


// ELIMINAR UN TEXTO DESDE LA BIBLIOTECA (sen confirmación: pódese desfacer)

function eliminarTextoDesdeBiblioteca(id) {

    eliminarTextos([id], "Texto eliminado.");

}


// ELIMINAR UN GRUPO COMPLETO (autor, obra, libro ou capítulo)

function eliminarNodo(nodo, tipo) {

    const ids = aplanarArbol(new Map([[nodo.nombre, nodo]])).map(function(texto) { return texto.id; });

    if (ids.length === 0) {
        return;
    }

    const confirmar = confirm(
        "Seguro que queres eliminar " + tipo.toLowerCase() + " «" + nodo.nombre + "» con " +
        ids.length + (ids.length === 1 ? " texto" : " textos") + " e as súas traducións?\n\n" +
        "Poderás recuperalos desde a Papeleira durante " + DIAS_PAPELERA + " días."
    );

    if (!confirmar) {
        return;
    }

    eliminarTextos(ids, ids.length + (ids.length === 1 ? " texto eliminado." : " textos eliminados."));

}


// GUARDAR LA BIBLIOTECA EN EL NAVEGADOR

let avisoEspazoMostrado = false;

function guardarBiblioteca() {

    try {
        localStorage.setItem("bibliotecaTextos", JSON.stringify(textos));
    } catch (error) {
        // Só se avisa unha vez por sesión para non molestar en cada gardado
        if (!avisoEspazoMostrado) {
            avisoEspazoMostrado = true;
            alert("Non se puido gardar no navegador (espazo cheo ou bloqueado). Fai unha copia de seguridade dos teus datos.");
        }
    }

    programarSincronizacion();

}


// MODO CLARO / ESCURO

function temaActual() {

    return document.documentElement.dataset.tema ||
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "oscuro" : "claro");

}

function actualizarBotonTema() {

    const boton = document.getElementById("botonTema");

    boton.textContent = temaActual() === "oscuro" ? "Modo claro" : "Modo escuro";

}

function cambiarTema() {

    const nuevo = temaActual() === "oscuro" ? "claro" : "oscuro";

    document.documentElement.dataset.tema = nuevo;

    try {
        localStorage.setItem("temaBiblioteca", nuevo);
    } catch (error) {
        // Sen almacenamento: o tema aplícase só nesta sesión
    }

    actualizarBotonTema();

}

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", actualizarBotonTema);


// GARDADO AUTOMÁTICO DA TRADUCIÓN (evita perdela ao cambiar de fragmento ou saír)

let temporizadorTraduccion = null;

function guardarTraduccionPendiente() {

    clearTimeout(temporizadorTraduccion);

    if (!textoActual || idCamposCargados !== textoActual.id) return;

    const valor = document.getElementById("campoTraduccion").value;
    const notaFragmento = document.getElementById("notaFragmento").value;

    if (valor === (textoActual.traduccion || "") &&
        notaFragmento === (textoActual.notaFragmento || "")) return;

    aplicarCambiosFragmento(valor, notaFragmento);

}

document.getElementById("campoTraduccion").addEventListener("input", function() {
    clearTimeout(temporizadorTraduccion);
    temporizadorTraduccion = setTimeout(guardarTraduccionPendiente, 1000);
});

window.addEventListener("pagehide", guardarTraduccionPendiente);


// ANÁLISE MORFOLÓXICA CON CLTK (servidor local: python servidor.py)

const URL_SERVIDOR = "http://127.0.0.1:8000";

let analisisActual = null;           // análise do texto aberto: lista indexada polo número de palabra
const cacheAnalisis = {};            // id do texto -> { texto, palabras } (só en memoria)

function prepararAnalisis() {

    const guardado = textoActual && cacheAnalisis[textoActual.id];

    analisisActual =
        guardado && guardado.texto === textoActual.textoOriginal
            ? guardado.palabras
            : null;

    document.getElementById("estadoAnalisis").textContent =
        analisisActual ? "Análise dispoñible: pasa o cursor ou preme unha palabra." : "";

}

const ETIQUETAS_RASGO = {
    Case: "Caso", Gender: "Xénero", Number: "Número", Person: "Persoa", Tense: "Tempo",
    Mood: "Modo", Voice: "Voz", Aspect: "Aspecto", Degree: "Grao", VerbForm: "Forma verbal",
    InflClass: "Flexión", PronType: "Tipo de pronome", NumType: "Tipo de numeral",
    Polarity: "Polaridade", Reflex: "Reflexivo", Poss: "Posesivo", Definite: "Definición"
};

const ORDE_RASGOS = ["Case", "Gender", "Number", "Person", "Tense", "Mood", "Voice", "Aspect", "Degree", "VerbForm", "InflClass"];

const CATEGORIAS = {
    noun: "Substantivo", verb: "Verbo", adj: "Adxectivo", adv: "Adverbio", pron: "Pronome",
    det: "Determinante", adp: "Preposición", cconj: "Conxunción coordinante",
    sconj: "Conxunción subordinante", aux: "Auxiliar", num: "Numeral", part: "Partícula",
    propn: "Nome propio", intj: "Interxección", punct: "Puntuación", sym: "Símbolo", x: "Outro"
};

const VALORES_RASGO = {
    nominative: "Nominativo", genitive: "Xenitivo", dative: "Dativo", accusative: "Acusativo",
    ablative: "Ablativo", vocative: "Vocativo", locative: "Locativo",
    masculine: "Masculino", feminine: "Feminino", neuter: "Neutro",
    singular: "Singular", plural: "Plural", dual: "Dual",
    present: "Presente", past: "Pasado", future: "Futuro", pluperfect: "Pretérito máis que perfecto", "future perfect": "Futuro perfecto",
    indicative: "Indicativo", subjunctive: "Subxuntivo", imperative: "Imperativo",
    active: "Activa", passive: "Pasiva", middle: "Media",
    perfect: "Perfecto", imperfect: "Imperfecto", perfective: "Perfectivo", imperfective: "Imperfectivo",
    positive: "Positivo", comparative: "Comparativo", superlative: "Superlativo",
    finite: "Finito", infinitive: "Infinitivo", participle: "Participio", gerund: "Xerundio",
    gerundive: "Xerundivo", supine: "Supino", aorist: "Aoristo", optative: "Optativo", mediopassive: "Medio-pasiva"
};

function traducirValor(valor) {

    const texto = String(valor || "");
    const clave = texto.toLowerCase();

    // «First declension (-a stems)» -> «1.ª declinación (-a stems)»
    const ordinales = { first: "1.ª", second: "2.ª", third: "3.ª", fourth: "4.ª", fifth: "5.ª" };
    const declinacion = clave.match(/^(first|second|third|fourth|fifth) (declension|conjugation)(.*)$/);

    if (declinacion) {
        return ordinales[declinacion[1]] + " " +
            (declinacion[2] === "declension" ? "declinación" : "conxugación") + declinacion[3];
    }

    return VALORES_RASGO[clave] || texto;

}

// Rasgos como obxecto {clave: valor}; se o servidor os mandou como texto («UDFeatureTagSet([…])») lense aquí
function rasgosDe(a) {

    const rasgos = (a && a.rasgos) || {};

    if (typeof rasgos.Rasgos === "string") {
        const lidos = {};
        const patron = /UDFeatureTag\((\w+)=(.+?)\)(?=,\s*UDFeatureTag|\]\))/g;
        let m;
        while ((m = patron.exec(rasgos.Rasgos)) !== null) lidos[m[1]] = m[2];
        if (Object.keys(lidos).length > 0) return lidos;
    }

    return rasgos;

}

// Formato orixinal (datos de CLTK sen traducir)
function describirAnalisisOrixinal(a) {

    if (!a) return "";

    const rasgos = rasgosDe(a);
    const lineas = [];

    if (a.lema) lineas.push("Lema: " + a.lema);
    if (a.categoria) lineas.push("Categoría: " + a.categoria);

    Object.keys(rasgos).forEach(function(clave) {
        lineas.push(clave + ": " + rasgos[clave]);
    });

    return lineas.join("\n");

}

// Datos da análise listos para amosar: { lema, categoria, rasgos: [[etiqueta, valor], ...] }
function estruturarAnalisis(a) {

    if (!a) return null;

    const rasgos = rasgosDe(a);

    const claves = Object.keys(rasgos).sort(function(x, y) {
        const i = ORDE_RASGOS.indexOf(x), j = ORDE_RASGOS.indexOf(y);
        return (i === -1 ? 99 : i) - (j === -1 ? 99 : j);
    });

    const categoria = a.categoria
        ? (CATEGORIAS[String(a.categoria).toLowerCase()] || a.categoria)
        : "";

    return {
        lema: a.lema || "",
        categoria: categoria,
        rasgos: claves.map(function(c) {
            return [ETIQUETAS_RASGO[c] || c, traducirValor(rasgos[c])];
        })
    };

}

function describirAnalisis(a) {

    const datos = estruturarAnalisis(a);

    if (!datos) return "";

    const lineas = [];

    if (datos.lema) lineas.push("Lema: " + datos.lema);
    if (datos.categoria) lineas.push("Categoría: " + datos.categoria);

    datos.rasgos.forEach(function(r) {
        lineas.push(r[0] + ": " + r[1]);
    });

    return lineas.join("\n");

}

function textoTooltip(palabra) {

    const a = analisisActual ? analisisActual[Number(palabra.dataset.indice)] : null;
    const analisis = a ? describirAnalisis(a) : "";
    const nota = palabra.dataset.nota || "";
    const axuda = a ? axudaCaso(a, palabra) : "";

    return [analisis, axuda, nota].filter(Boolean).join("\n\n");

}

function mostrarAnalisisEnEditor(indice) {

    const caja = document.getElementById("analisisPalabra");
    const boton = document.getElementById("botonInsertarAnalisis");

    const datos = analisisActual ? estruturarAnalisis(analisisActual[indice]) : null;

    caja.replaceChildren();

    if (datos) {

        const cabeza = crearElemento("div", "analisis-cabeza");

        if (datos.lema) cabeza.appendChild(crearElemento("span", "analisis-lema", datos.lema));
        if (datos.categoria) cabeza.appendChild(crearElemento("span", "chip chip-categoria", datos.categoria));

        caja.appendChild(cabeza);

        const rasgos = crearElemento("div", "analisis-rasgos");

        datos.rasgos.forEach(function(r) {
            const chip = crearElemento("span", "chip");
            chip.appendChild(crearElemento("small", "", r[0]));
            chip.appendChild(document.createTextNode(r[1]));
            rasgos.appendChild(chip);
        });

        caja.appendChild(rasgos);

    }

    caja.classList.toggle("oculto", !datos);
    boton.classList.toggle("oculto", !datos);

    const textoLista = analisisActual ? describirAnalisisOrixinal(analisisActual[indice]) : "";

    document.getElementById("analisisListaTexto").textContent = textoLista;
    document.getElementById("analisisLista").classList.toggle("oculto", !textoLista);

    mostrarInfoCaso(indice);
    mostrarPasaxes(indice);

}

function insertarAnalisisEnNota() {

    if (!analisisActual || palabraSeleccionada === null) return;

    const descripcion = describirAnalisis(analisisActual[palabraSeleccionada]);

    if (!descripcion) return;

    const campo = document.getElementById("campoNotaPalabra");

    campo.value = campo.value.trim()
        ? campo.value.trim() + "\n\n" + descripcion
        : descripcion;

    autoajustarCampoNota();
    campo.focus();

}

let ultimoFalloServidor = 0;

async function analizarTextoActual(automatico) {

    if (!textoActual) return;

    const id = textoActual.id;
    const contenido = textoActual.textoOriginal;
    const boton = document.getElementById("botonAnalizar");
    const estado = document.getElementById("estadoAnalisis");

    boton.disabled = true;
    estado.textContent = automatico === true
        ? "Cargando análise…"
        : "Analizando co servidor CLTK (a primeira vez pode tardar)…";

    try {

        const respuesta = await fetch(URL_SERVIDOR + "/analizar", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ texto: contenido, idioma: textoActual.idioma, forzar: automatico !== true })
        });

        const datos = await respuesta.json();

        if (!respuesta.ok || datos.estado !== "ok") {
            throw new Error(datos.mensaje || ("Erro " + respuesta.status));
        }

        cacheAnalisis[id] = { texto: contenido, palabras: datos.palabras };

        const objetivo = textos.find(function(t) { return t.id === id; });

        if (objetivo && objetivo.textoOriginal === contenido) {
            registrarVocabulario(objetivo, datos.palabras);
        }

        // Se mentres tanto se abriu outro texto, a resposta gárdase pero non se mostra
        if (textoActual && textoActual.id === id) {
            analisisActual = datos.palabras;
            aplicarColoresGramatica();

            const total = datos.palabras.length;
            const feitas = datos.palabras.filter(Boolean).length;

            estado.textContent =
                "Análise lista (" + feitas + " de " + total + " palabras). Pasa o cursor ou preme unha palabra.";
        }

    } catch (error) {

        // Calquera fallo (servidor parado ou erro de CLTK) pausa a análise automática 20 s
        ultimoFalloServidor = Date.now();

        if (textoActual && textoActual.id === id) {
            if (error instanceof TypeError) {
                estado.textContent = "Non hai conexión co servidor CLTK. Arránqueo con «python servidor.py».";
            } else if (error instanceof SyntaxError) {
                estado.textContent = "O servidor devolveu unha resposta non válida. Mira a xanela de «python servidor.py».";
            } else {
                estado.textContent = "Non se puido analizar: " + error.message;
            }
        }

    } finally {

        boton.disabled = false;

    }

}


// MODO ESTUDO (só lectura)

let modoEstudo = false;

try {
    modoEstudo = localStorage.getItem("bibliotecaModoEstudo") === "1";
} catch (e) {}

function renderizarTraduccionLectura() {

    const lectura = document.getElementById("traduccionLectura");
    const valor = document.getElementById("campoTraduccion").value.trim();

    lectura.replaceChildren();

    if (!valor) {
        lectura.appendChild(crearElemento("p", "traduccion-vacia", "Aínda non hai tradución deste fragmento."));
        return;
    }

    valor.split(/\n{2,}/).forEach(function(parrafo) {
        lectura.appendChild(crearElemento("p", "", parrafo.trim()));
    });

}

function aplicarModoEstudo() {

    document.body.classList.toggle("modo-estudo", modoEstudo);

    const boton = document.getElementById("botonModoEstudo");

    boton.textContent = modoEstudo ? "Modo edición" : "Modo estudo";
    boton.setAttribute("aria-pressed", String(modoEstudo));

    document.getElementById("campoTraduccion").classList.toggle("oculto", modoEstudo);
    document.getElementById("traduccionLectura").classList.toggle("oculto", !modoEstudo);
    document.getElementById("estadoTexto").disabled = modoEstudo;
    document.getElementById("campoNotaPalabra").readOnly = modoEstudo;
    document.getElementById("notaFragmento").readOnly = modoEstudo;

    document.querySelector("#editorNotaPalabra .acciones-finales .boton-secundario").textContent =
        modoEstudo ? "Pechar" : "Cancelar";

    if (modoEstudo) renderizarTraduccionLectura();

}

function alternarModoEstudo() {

    guardarTraduccionPendiente();

    modoEstudo = !modoEstudo;

    try { localStorage.setItem("bibliotecaModoEstudo", modoEstudo ? "1" : "0"); } catch (e) {}

    cerrarEditorNota(false);
    aplicarModoEstudo();

}


// ESTADO E PROGRESO

const ETIQUETAS_ESTADO = { pendiente: "Pendente", borrador: "Borrador", revisado: "Revisado" };

function estadoDe(texto) {

    return ETIQUETAS_ESTADO[texto.estado] ? texto.estado : "pendiente";

}

function cambiarEstadoTexto() {

    if (!textoActual || modoEstudo) return;

    textoActual.estado = document.getElementById("estadoTexto").value;
    textoActual.fechaModificacion = new Date().toISOString();
    guardarBiblioteca();

    avisar("Estado: " + ETIQUETAS_ESTADO[textoActual.estado] + ".");

}

// Se hai tradución e o texto seguía pendente, pasa a borrador
function actualizarEstadoAutomatico() {

    if (!textoActual || !textoActual.traduccion || !textoActual.traduccion.trim()) return;

    if (estadoDe(textoActual) === "pendiente") {
        textoActual.estado = "borrador";
        document.getElementById("estadoTexto").value = "borrador";
    }

}

function contarEstados(nodo) {

    const cuenta = { total: 0, revisado: 0, borrador: 0 };

    function sumar(n) {
        n.fragmentos.forEach(function(t) {
            cuenta.total++;
            const e = estadoDe(t);
            if (e !== "pendiente") cuenta[e]++;
        });
        n.hijos.forEach(sumar);
    }

    sumar(nodo);

    return cuenta;

}

function crearBarraProgreso(cuenta) {

    const barra = crearElemento("span", "barra-progreso");

    [["revisado", "rev"], ["borrador", "bor"]].forEach(function(par) {
        const tramo = crearElemento("span", par[1]);
        tramo.style.width = (cuenta.total ? (100 * cuenta[par[0]] / cuenta.total) : 0) + "%";
        barra.appendChild(tramo);
    });

    return barra;

}

function crearProgreso(cuenta) {

    const caja = crearElemento("span", "progreso-grupo");

    caja.title = cuenta.revisado + " revisados, " + cuenta.borrador + " en borrador, " +
        (cuenta.total - cuenta.revisado - cuenta.borrador) + " pendentes";

    caja.appendChild(crearBarraProgreso(cuenta));
    caja.appendChild(crearElemento("span", "", cuenta.revisado + "/" + cuenta.total));

    return caja;

}

function mostrarResumenProgreso() {

    const caja = document.getElementById("resumenProgreso");

    const cuenta = { total: textos.length, revisado: 0, borrador: 0 };

    textos.forEach(function(t) {
        const e = estadoDe(t);
        if (e !== "pendiente") cuenta[e]++;
    });

    caja.replaceChildren();
    caja.classList.toggle("oculto", cuenta.total === 0);
    document.getElementById("botonContinuar").classList.toggle("oculto", cuenta.total === 0);

    if (cuenta.total === 0) return;

    caja.appendChild(crearBarraProgreso(cuenta));
    caja.appendChild(crearElemento("span", "", 
        cuenta.revisado + " revisados · " + cuenta.borrador + " en borrador · " +
        (cuenta.total - cuenta.revisado - cuenta.borrador) + " pendentes de " + cuenta.total));

    const actividadHoy = crearChipActividad();

    if (actividadHoy) caja.appendChild(actividadHoy);

}

function continuarUltimo() {

    let id = null;

    try { id = localStorage.getItem("bibliotecaUltimo"); } catch (e) {}

    let texto = textos.find(function(t) { return t.id === id; });

    if (!texto) {
        texto = textos.slice().sort(function(a, b) { return fechaDe(b) - fechaDe(a); })[0];
    }

    if (!texto) {
        return;
    }

    abrirTexto(texto.id);

    // Recupera onde ían a lectura (a posición gárdase ao pechar a páxina)
    try {
        const guardada = JSON.parse(localStorage.getItem("bibliotecaPosicion"));

        if (guardada && guardada.id === texto.id) {
            requestAnimationFrame(function() {
                window.scrollTo({ top: guardada.y || 0, behavior: "instant" });
            });
        }
    } catch (e) {}

}


// DICIONARIOS

function actualizarEnlacesDiccionario(elemento, indice) {

    const forma = elemento.textContent;
    const analisis = analisisActual && analisisActual[indice];
    const termo = (analisis && analisis.lema) || forma;
    const lingua = textoActual && textoActual.idioma === "griego" ? "greek" : "la";

    document.getElementById("enlaceLogeion").href =
        "https://logeion.uchicago.edu/" + encodeURIComponent(termo);

    document.getElementById("enlacePerseus").href =
        "https://www.perseus.tufts.edu/hopper/morph?l=" + encodeURIComponent(forma) + "&la=" + lingua;

}


// SINCRONIZACIÓN COA NUBE (biblioteca.json nunha carpeta de Drive/OneDrive, xestionada por servidor.py)

let eliminados = {};   // id -> data de eliminación (para que un borrado tamén se propague)

try {
    eliminados = JSON.parse(localStorage.getItem("bibliotecaEliminados")) || {};
} catch (e) {
    eliminados = {};
}

function marcarEliminado(id) {

    eliminados[id] = new Date().toISOString();

    try {
        localStorage.setItem("bibliotecaEliminados", JSON.stringify(eliminados));
    } catch (e) {}

}

function fechaDe(texto) {

    return Date.parse(texto.fechaModificacion || texto.fechaCreacion || "") || 0;

}

// Fusiona dúas listas: gaña a versión máis recente de cada texto; un borrado gaña se é posterior
function fusionar(locais, remotos, tumbasLocais, tumbasRemotas) {

    const tumbas = Object.assign({}, tumbasRemotas);

    Object.keys(tumbasLocais).forEach(function(id) {
        if (!tumbas[id] || tumbasLocais[id] > tumbas[id]) tumbas[id] = tumbasLocais[id];
    });

    const mapa = new Map();

    locais.concat(remotos).forEach(function(t) {

        if (!t || !t.id) return;

        const actual = mapa.get(t.id);

        if (!actual || fechaDe(t) > fechaDe(actual)) mapa.set(t.id, t);

    });

    const resultado = [];

    mapa.forEach(function(t, id) {

        const tumba = tumbas[id] ? Date.parse(tumbas[id]) : 0;

        if (!tumba || fechaDe(t) > tumba) resultado.push(t);

    });

    return { textos: resultado, eliminados: tumbas };

}

function firmaBiblioteca(lista) {

    return lista.map(function(t) { return t.id + "@" + (t.fechaModificacion || t.fechaCreacion || ""); }).join("|");

}

let sincronizando = false;
let temporizadorReintento = null;

// Se falla (servidor parado, ficheiro bloqueado por OneDrive…) volve tentalo sen perder datos locais
function programarReintento() {

    clearTimeout(temporizadorReintento);
    temporizadorReintento = setTimeout(function() { sincronizar(false); }, 30000);

}
let temporizadorSync = null;

function estadoNube(mensaje) {

    const elemento = document.getElementById("estadoNube");

    if (!elemento) return;

    elemento.textContent = mensaje;
    elemento.title = mensaje;
    elemento.dataset.estado =
        /^Sincronizando/.test(mensaje) ? "sync" :
        /^Sincronizado/.test(mensaje) ? "ok" :
        /^Pendente/.test(mensaje) ? "pendente" :
        /^Erro/.test(mensaje) ? "erro" : "";

}

function programarSincronizacion() {

    clearTimeout(temporizadorSync);
    temporizadorSync = setTimeout(function() { sincronizar(false); }, 3000);

}

async function sincronizar(manual) {

    if (sincronizando) return;

    sincronizando = true;
    estadoNube("Sincronizando…");

    try {

        guardarTraduccionPendiente();

        const resposta = await fetch(URL_SERVIDOR + "/biblioteca");
        const remoto = await resposta.json();

        if (!resposta.ok || remoto.estado !== "ok") throw new Error(remoto.mensaxe || remoto.mensaje || "Erro " + resposta.status);

        const datos = remoto.datos || { textos: [], eliminados: {} };
        const fusion = fusionar(textos, Array.isArray(datos.textos) ? datos.textos : [], eliminados, datos.eliminados || {});

        vocabulario = fusionarVocabulario(vocabulario, datos.vocabulario || {});

        try { localStorage.setItem("bibliotecaVocabulario", JSON.stringify(vocabulario)); } catch (e) {}

        const idActual = textoActual && textoActual.id;
        const firmaAntes = firmaBiblioteca(textos);

        textos = fusion.textos;
        eliminados = fusion.eliminados;

        try {
            localStorage.setItem("bibliotecaTextos", JSON.stringify(textos));
            localStorage.setItem("bibliotecaEliminados", JSON.stringify(eliminados));
        } catch (e) {}

        textoActual = idActual ? (textos.find(function(t) { return t.id === idActual; }) || null) : null;

        const envio = await fetch(URL_SERVIDOR + "/biblioteca", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ textos: textos, eliminados: eliminados, vocabulario: vocabulario })
        });

        const resultado = await envio.json();

        if (!envio.ok || resultado.estado !== "ok") throw new Error(resultado.mensaje || "Erro " + envio.status);

        // Só se repinta se a fusión cambiou algo: repintar sempre fai perder o foco e o lugar de lectura
        if (firmaAntes !== firmaBiblioteca(textos) &&
            !document.getElementById("pantallaBiblioteca").classList.contains("oculto")) {
            mostrarBiblioteca();
        }

        clearTimeout(temporizadorReintento);
        estadoNube("Sincronizado " + new Date().toLocaleTimeString("gl", { hour: "2-digit", minute: "2-digit" }));

    } catch (error) {

        estadoNube(error instanceof TypeError
            ? "Pendente: sen servidor (gardado só neste navegador)"
            : "Erro de sincronización: " + error.message);

        programarReintento();

    } finally {

        sincronizando = false;

    }

}


// MELLORAS DE USO: tamaño, busca, continuar, exportación e atallos

let tamanoTexto = 0;

try { tamanoTexto = parseInt(localStorage.getItem("bibliotecaTamano"), 10) || 0; } catch (e) {}

function cambiarTamanoTexto(paso) {

    tamanoTexto = Math.max(-3, Math.min(6, tamanoTexto + paso));

    try { localStorage.setItem("bibliotecaTamano", String(tamanoTexto)); } catch (e) {}

    document.documentElement.style.setProperty("--tam-texto", (22 + tamanoTexto * 2) + "px");

}

let temporizadorBusca = null;

function buscarConRetraso() {

    clearTimeout(temporizadorBusca);
    temporizadorBusca = setTimeout(mostrarBiblioteca, 200);

}

function abrirAxuda() {

    const caixa = document.getElementById("axuda");

    if (!caixa.open) caixa.showModal();

}

function actualizarBotonContinuar() {

    const boton = document.getElementById("botonContinuar");
    let id = null;

    try { id = localStorage.getItem("bibliotecaUltimo"); } catch (e) {}

    const texto = textos.find(function(t) { return t.id === id; });

    boton.textContent = texto
        ? "Continuar: " + (texto.referencia || texto.obra)
        : "Continuar onde o deixei";

}

// Lembra a posición de desprazamento do último texto aberto
window.addEventListener("pagehide", function() {

    if (!textoActual || document.getElementById("pantallaTexto").classList.contains("oculto")) return;

    try {
        localStorage.setItem("bibliotecaPosicion", JSON.stringify({ id: textoActual.id, y: window.scrollY }));
    } catch (e) {}

});

// Exportación en varios formatos (TXT usa o contido xa construído)
function palabrasDe(texto) {

    return (texto.textoOriginal || "").match(/[\p{L}\p{M}]+(?:[’'][\p{L}\p{M}]+)*/gu) || [];

}

function notasDePalabras(texto) {

    const palabras = palabrasDe(texto);

    return Object.keys(texto.notasPalabras || {}).map(function(i) {
        return [palabras[Number(i)] || "?", texto.notasPalabras[i]];
    });

}

function escaparHtml(valor) {

    return String(valor || "").replace(/[&<>"]/g, function(c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });

}

function prepararExportacion(contenidoTxt, fragmentos, nodo) {

    const formato = document.getElementById("formatoExportacion").value;
    const primero = fragmentos[0];
    const titulo = [primero.autor, primero.obra, nodo.nombre].filter(Boolean).join(" · ");

    if (formato === "json") {
        return { ext: "json", mime: "application/json", contenido: JSON.stringify({ titulo: titulo, fragmentos: fragmentos }, null, 2) };
    }

    if (formato === "md") {
        const partes = ["# " + titulo];
        fragmentos.forEach(function(t) {
            partes.push("## " + (t.referencia || t.obra));
            partes.push("**Texto orixinal**\n\n" + (t.textoOriginal || "").split("\n").map(function(l) { return "> " + l; }).join("\n"));
            partes.push("**Tradución**\n\n" + (t.traduccion || "_Sen traducir_"));
            if (t.notaFragmento) partes.push("**Notas do fragmento**\n\n" + t.notaFragmento);
            const notas = notasDePalabras(t);
            if (notas.length) partes.push("**Notas de palabras**\n\n" + notas.map(function(n) { return "- *" + n[0] + "*: " + n[1].replace(/\n+/g, " "); }).join("\n"));
        });
        return { ext: "md", mime: "text/markdown", contenido: partes.join("\n\n") + "\n" };
    }

    if (formato === "html") {
        const corpo = fragmentos.map(function(t) {
            const notas = notasDePalabras(t).map(function(n) { return "<li><em>" + escaparHtml(n[0]) + "</em>: " + escaparHtml(n[1]) + "</li>"; }).join("");
            return "<section><h2>" + escaparHtml(t.referencia || t.obra) + "</h2>" +
                "<div class=\"par\"><div><h3>Texto orixinal</h3><p>" + escaparHtml(t.textoOriginal) + "</p></div>" +
                "<div><h3>Tradución</h3><p>" + escaparHtml(t.traduccion) + "</p></div></div>" +
                (t.notaFragmento ? "<h3>Notas do fragmento</h3><p>" + escaparHtml(t.notaFragmento) + "</p>" : "") +
                (notas ? "<h3>Notas de palabras</h3><ul>" + notas + "</ul>" : "") + "</section>";
        }).join("\n");
        return { ext: "html", mime: "text/html", contenido:
            "<!DOCTYPE html><html lang=\"gl\"><head><meta charset=\"utf-8\"><title>" + escaparHtml(titulo) + "</title><style>" +
            "body{max-width:960px;margin:2rem auto;padding:0 1rem;font:18px/1.7 Georgia,serif;color:#222}h3{font:600 12px sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#777}" +
            "p{white-space:pre-wrap}.par{display:grid;grid-template-columns:1fr 1fr;gap:2rem}section{border-top:1px solid #ccc;padding-top:1rem}" +
            "@media(max-width:700px){.par{grid-template-columns:1fr}}</style></head><body><h1>" + escaparHtml(titulo) + "</h1>" + corpo + "</body></html>" };
    }

    return { ext: "txt", mime: "text/plain", contenido: contenidoTxt };

}

// Atallos de teclado (a axuda móstrase con «?»)
document.addEventListener("keydown", function(evento) {

    const escribindo = /^(INPUT|TEXTAREA|SELECT)$/.test(evento.target.tagName);
    const enTexto = !document.getElementById("pantallaTexto").classList.contains("oculto");
    const enBiblioteca = !document.getElementById("pantallaBiblioteca").classList.contains("oculto");

    if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === "s") {
        evento.preventDefault();
        if (enTexto) guardarCambios(); else sincronizar(true);
        return;
    }

    if (evento.altKey && !evento.ctrlKey && !evento.metaKey) {
        const tecla = evento.key.toLowerCase();
        if (tecla === "e" && enTexto) { evento.preventDefault(); alternarModoEstudo(); }
        if (tecla === "a" && enTexto) { evento.preventDefault(); analizarTextoActual(); }
        if (tecla === "c" && enTexto) { evento.preventDefault(); alternarColores(); }
        if (tecla === "n" && enTexto) { evento.preventDefault(); irAlSiguientePendiente(); }
        if (tecla === "t") { evento.preventDefault(); cambiarTema(); }
        return;
    }

    if (escribindo || evento.ctrlKey || evento.metaKey) return;

    if (evento.key === "/" && enBiblioteca) {
        evento.preventDefault();
        document.getElementById("buscador").focus();
    }

    if (evento.key === "?") abrirAxuda();

});

document.getElementById("notaFragmento").addEventListener("input", function() {
    clearTimeout(temporizadorTraduccion);
    temporizadorTraduccion = setTimeout(guardarTraduccionPendiente, 1000);
});


// VOCABULARIO (lemas de CLTK + significado e estado de estudo de cada lema)

const EXCLUIDAS_VOCAB = { punct: 1, sym: 1, num: 1, x: 1, propn: 1 };
const ETIQUETAS_VOCAB = { nueva: "Nova", aprendiendo: "Aprendendo", sabida: "Sabida" };
const PASO_VOCAB = 150;

let vocabulario = {};        // clave «idioma|lema» -> { sig: significado, est: estado, f: data }
let limiteVocab = PASO_VOCAB;
let repaso = null;
let temporizadorVocab = null;

try {
    vocabulario = JSON.parse(localStorage.getItem("bibliotecaVocabulario")) || {};
} catch (e) {
    vocabulario = {};
}

function guardarVocabulario() {

    try {
        localStorage.setItem("bibliotecaVocabulario", JSON.stringify(vocabulario));
    } catch (e) {}

    programarSincronizacion();

}

function claveVocab(idioma, lema) {

    return idioma + "|" + String(lema).trim().toLowerCase();

}

function estadoVocab(clave) {

    const dato = vocabulario[clave];

    return dato && ETIQUETAS_VOCAB[dato.est] ? dato.est : "nueva";

}

function actualizarDatoVocab(clave, cambios) {

    const dato = Object.assign({ sig: "", est: "nueva" }, vocabulario[clave], cambios);

    dato.f = new Date().toISOString();
    vocabulario[clave] = dato;

    guardarVocabulario();

}

function huellaTexto(valor) {

    let h = 5381;

    for (let i = 0; i < valor.length; i++) {
        h = ((h << 5) + h + valor.charCodeAt(i)) | 0;
    }

    return h + ":" + valor.length;

}

// Lista compacta de lemas de un texto: [{ l: lema, c: categoría, n: veces, f: [formas] }]
function extraerVocabulario(palabras) {

    const mapa = new Map();

    palabras.forEach(function(a) {

        if (!a || !a.lema) return;

        const categoria = String(a.categoria || "").toLowerCase();
        const lema = String(a.lema).trim();

        if (!lema || EXCLUIDAS_VOCAB[categoria]) return;

        const k = lema.toLowerCase();
        let e = mapa.get(k);

        if (!e) {
            e = { l: lema, c: categoria, n: 0, f: [] };
            mapa.set(k, e);
        }

        e.n++;

        if (a.forma && e.f.indexOf(a.forma) === -1 && e.f.length < 8) e.f.push(a.forma);

    });

    return Array.from(mapa.values());

}

function registrarVocabulario(texto, palabras) {

    texto.vocabulario = extraerVocabulario(palabras);
    texto.vocabHuella = huellaTexto(texto.textoOriginal || "");

    guardarBiblioteca();

}

function tieneVocabulario(texto) {

    return Array.isArray(texto.vocabulario) &&
        texto.vocabHuella === huellaTexto(texto.textoOriginal || "");

}

function textosDelFiltroVocab() {

    const idioma = document.getElementById("vocabIdioma").value;
    const obra = document.getElementById("vocabObra").value;

    return textos.filter(function(t) {
        return (idioma === "todos" || t.idioma === idioma) &&
            (obra === "todas" || (t.autor + " · " + t.obra) === obra);
    });

}

function recopilarVocabulario() {

    const mapa = new Map();
    let sinAnalizar = 0;

    textosDelFiltroVocab().forEach(function(t) {

        if (!tieneVocabulario(t)) {
            sinAnalizar++;
            return;
        }

        t.vocabulario.forEach(function(e) {

            const k = claveVocab(t.idioma, e.l);
            let r = mapa.get(k);

            if (!r) {
                r = { clave: k, idioma: t.idioma, lema: e.l, cat: e.c, n: 0, formas: [], refs: [] };
                mapa.set(k, r);
            }

            r.n += e.n;

            e.f.forEach(function(f) {
                if (r.formas.indexOf(f) === -1 && r.formas.length < 10) r.formas.push(f);
            });

            const ref = t.referencia || t.obra;
            if (r.refs.length < 6 && r.refs.indexOf(ref) === -1) r.refs.push(ref);

        });

    });

    // Palabras engadidas a man (non dependen de CLTK)
    const idiomaFiltro = document.getElementById("vocabIdioma").value;
    const obraFiltro = document.getElementById("vocabObra").value;

    Object.keys(vocabulario).forEach(function(clave) {

        const m = vocabulario[clave].man;

        if (!m) return;
        if (idiomaFiltro !== "todos" && m.idioma !== idiomaFiltro) return;
        if (obraFiltro !== "todas" && m.obra !== obraFiltro) return;

        let r = mapa.get(clave);

        if (!r) {
            r = { clave: clave, idioma: m.idioma, lema: m.lema, cat: "", n: 0, formas: [], refs: [] };
            mapa.set(clave, r);
        }

        r.manual = true;

        if (m.forma && r.formas.indexOf(m.forma) === -1 && r.formas.length < 10) r.formas.push(m.forma);
        if (m.ref && r.refs.indexOf(m.ref) === -1 && r.refs.length < 6) r.refs.push(m.ref);

    });

    return { lista: Array.from(mapa.values()), sinAnalizar: sinAnalizar };

}

function vocabularioFiltrado() {

    const datos = recopilarVocabulario();
    const estado = document.getElementById("vocabEstado").value;
    const orde = document.getElementById("vocabOrde").value;
    const busca = simplificar(document.getElementById("vocabBusca").value.trim());

    let lista = datos.lista.filter(function(r) {

        if (estado !== "todos" && estadoVocab(r.clave) !== estado) return false;

        if (!busca) return true;

        const dato = vocabulario[r.clave] || {};

        return simplificar(r.lema).includes(busca) ||
            simplificar(r.formas.join(" ")).includes(busca) ||
            simplificar(dato.sig).includes(busca);

    });

    lista.sort(function(a, b) {
        return orde === "alfabetico"
            ? simplificar(a.lema).localeCompare(simplificar(b.lema))
            : (b.n - a.n) || simplificar(a.lema).localeCompare(simplificar(b.lema));
    });

    return { lista: lista, total: datos.lista, sinAnalizar: datos.sinAnalizar };

}

function buscarVocabularioConRetraso() {

    clearTimeout(temporizadorVocab);
    temporizadorVocab = setTimeout(function() { mostrarVocabulario(true); }, 200);

}

function rellenarSelectorObras() {

    const selector = document.getElementById("vocabObra");
    const anterior = selector.value || "todas";
    const obras = [];

    textos.forEach(function(t) {
        const nombre = t.autor + " · " + t.obra;
        if (obras.indexOf(nombre) === -1) obras.push(nombre);
    });

    obras.sort(function(a, b) { return a.localeCompare(b); });

    selector.replaceChildren();

    const todas = crearElemento("option", "", "Todas as obras");
    todas.value = "todas";
    selector.appendChild(todas);

    obras.forEach(function(nombre) {
        const opcion = crearElemento("option", "", nombre);
        opcion.value = nombre;
        selector.appendChild(opcion);
    });

    selector.value = obras.indexOf(anterior) !== -1 ? anterior : "todas";

}

function mostrarVocabulario(mantener) {

    if (mantener !== true) {
        guardarTraduccionPendiente();
        rellenarSelectorObras();
    }

    limiteVocab = PASO_VOCAB;

    mostrarPantalla("pantallaVocabulario");

    pintarVocabulario();

}

function actualizarResumenVocab(lista, sinAnalizar) {

    const cuentas = { nueva: 0, aprendiendo: 0, sabida: 0 };

    lista.forEach(function(r) { cuentas[estadoVocab(r.clave)]++; });

    document.getElementById("resumenVocabulario").textContent =
        lista.length + " lemas · " + cuentas.nueva + " novos · " + cuentas.aprendiendo +
        " aprendendo · " + cuentas.sabida + " sabidos" +
        (sinAnalizar ? " · " + sinAnalizar + " textos sen analizar" : "");

}

function pintarVocabulario() {

    actualizarContaEspaciado();

    const contenedor = document.getElementById("listaVocabulario");
    const datos = vocabularioFiltrado();
    actualizarResumenVocab(datos.total, datos.sinAnalizar);

    document.getElementById("botonAnalizarTodo").classList.toggle("oculto", datos.sinAnalizar === 0);

    contenedor.replaceChildren();

    if (datos.lista.length === 0) {

        const vacio = crearElemento("div", "vacio");

        vacio.appendChild(crearElemento("h3", "", datos.total.length === 0 ? "Aínda non hai vocabulario" : "Non hai resultados"));
        vacio.appendChild(crearElemento("p", "",
            datos.total.length === 0
                ? "Engade palabras a man co formulario de arriba, ou usa «Analizar textos pendentes» (precisa o servidor CLTK)."
                : "Proba con outra busca ou cambia os filtros."));

        contenedor.appendChild(vacio);
        return;

    }

    datos.lista.slice(0, limiteVocab).forEach(function(r) {
        contenedor.appendChild(crearFilaVocab(r));
    });

    if (datos.lista.length > limiteVocab) {
        contenedor.appendChild(crearBoton(
            "Mostrar máis (" + (datos.lista.length - limiteVocab) + " restantes)",
            "boton-secundario",
            function() { limiteVocab += PASO_VOCAB; pintarVocabulario(); }
        ));
    }

}

function enlaceLogeion(r) {

    const enlace = crearElemento("a", "", "Logeion ↗");

    enlace.href = "https://logeion.uchicago.edu/" + encodeURIComponent(r.lema);
    enlace.target = "_blank";
    enlace.rel = "noopener noreferrer";

    return enlace;

}

function crearFilaVocab(r) {

    const fila = crearElemento("div", "fila-vocab");
    const dato = vocabulario[r.clave] || {};

    fila.dataset.idioma = r.idioma;

    const cabeza = crearElemento("div", "vocab-cabeza");
    cabeza.appendChild(crearElemento("strong", "vocab-lema", r.lema));

    if (r.cat) cabeza.appendChild(crearElemento("span", "chip chip-categoria", CATEGORIAS[r.cat] || r.cat));

    cabeza.appendChild(crearElemento("span", "vocab-frecuencia", r.n ? "×" + r.n : "a man"));
    fila.appendChild(cabeza);

    fila.appendChild(crearElemento("div", "vocab-formas", r.formas.join(", ") + (r.refs.length ? "  ·  " + r.refs.join("; ") : "")));

    const significado = crearElemento("input", "vocab-significado");
    significado.type = "text";
    significado.placeholder = "Significado…";
    significado.value = dato.sig || "";
    significado.setAttribute("aria-label", "Significado de " + r.lema);
    significado.addEventListener("change", function() {
        actualizarDatoVocab(r.clave, { sig: significado.value.trim() });
    });
    fila.appendChild(significado);

    const estado = crearElemento("select", "vocab-estado");
    estado.setAttribute("aria-label", "Estado de " + r.lema);

    Object.keys(ETIQUETAS_VOCAB).forEach(function(k) {
        const opcion = crearElemento("option", "", ETIQUETAS_VOCAB[k]);
        opcion.value = k;
        estado.appendChild(opcion);
    });

    estado.value = estadoVocab(r.clave);
    estado.addEventListener("change", function() {
        actualizarDatoVocab(r.clave, { est: estado.value });
        pintarResumenVocab();
    });
    fila.appendChild(estado);

    fila.appendChild(enlaceLogeion(r));

    if (r.manual && r.n === 0) {
        const quitar = crearBoton("Quitar", "boton-peligro boton-pequeno boton-quitar", function() { quitarVocabManual(r.clave); });
        quitar.setAttribute("aria-label", "Quitar " + r.lema + " do vocabulario");
        fila.appendChild(quitar);
    }

    return fila;

}

function pintarResumenVocab() {

    const datos = recopilarVocabulario();

    actualizarResumenVocab(datos.lista, datos.sinAnalizar);

}

// Analizar en tanda os textos do filtro que aínda non teñen lemas gardados
async function analizarPendientes() {

    const pendientes = textosDelFiltroVocab().filter(function(t) { return !tieneVocabulario(t); });
    const boton = document.getElementById("botonAnalizarTodo");
    const estado = document.getElementById("estadoAnalisisTodo");

    if (pendientes.length === 0) return;

    boton.disabled = true;

    let feitos = 0;

    try {

        for (const texto of pendientes) {

            estado.textContent = "Analizando " + (feitos + 1) + " de " + pendientes.length + "…";

            const respuesta = await fetch(URL_SERVIDOR + "/analizar", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ texto: texto.textoOriginal, idioma: texto.idioma })
            });

            const datos = await respuesta.json();

            if (!respuesta.ok || datos.estado !== "ok") {
                throw new Error(datos.mensaje || ("Erro " + respuesta.status));
            }

            registrarVocabulario(texto, datos.palabras);
            feitos++;

        }

        estado.textContent = "Análise completada: " + feitos + " textos.";

    } catch (error) {

        estado.textContent = (error instanceof TypeError
            ? "Non hai conexión co servidor CLTK. Arránqueo con «python servidor.py»."
            : "Parouse tras " + feitos + " textos: " + error.message);

    } finally {

        boton.disabled = false;
        pintarVocabulario();

    }

}


// REPASO CON TARXETAS

function empezarRepaso() {

    const cola = vocabularioFiltrado().lista.filter(function(r) {
        return estadoVocab(r.clave) !== "sabida";
    });

    if (cola.length === 0) {
        alert("Non hai lemas por repasar con estes filtros (os marcados como «Sabida» non entran).");
        return;
    }

    for (let i = cola.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const aux = cola[i]; cola[i] = cola[j]; cola[j] = aux;
    }

    repaso = { cola: cola, total: cola.length, feitas: 0, visible: false };

    pintarRepaso();

}

function pintarRepaso() {

    const caja = document.getElementById("repasoVocabulario");

    caja.replaceChildren();

    if (!repaso) {
        caja.classList.add("oculto");
        return;
    }

    caja.classList.remove("oculto");
    if (repaso.cola.length) caja.dataset.idioma = repaso.cola[0].idioma;

    if (repaso.cola.length === 0) {
        caja.appendChild(crearElemento("h3", "", "Repaso rematado"));
        caja.appendChild(crearElemento("p", "", repaso.feitas + (repaso.modo === "sm2" ? " lemas repasados." : " lemas marcados como sabidos.")));
        caja.appendChild(crearBoton("Pechar", "boton-secundario", function() { repaso = null; pintarRepaso(); pintarVocabulario(); }));
        return;
    }

    const r = repaso.cola[0];
    const dato = vocabulario[r.clave] || {};

    caja.appendChild(crearElemento("div", "repaso-contador", "Quedan " + repaso.cola.length + (repaso.modo === "sm2" ? " · repasadas " : " · sabidas ") + repaso.feitas + " de " + repaso.total));
    caja.appendChild(crearElemento("div", "repaso-lema", r.lema));
    caja.appendChild(crearElemento("div", "repaso-categoria", CATEGORIAS[r.cat] || r.cat || ""));

    if (!repaso.visible) {

        caja.appendChild(crearBoton("Amosar resposta", "", function() { repaso.visible = true; pintarRepaso(); }));

    } else {

        const significado = crearElemento("input", "vocab-significado");
        significado.type = "text";
        significado.placeholder = "Escribe o significado…";
        significado.value = dato.sig || "";
        significado.addEventListener("change", function() {
            actualizarDatoVocab(r.clave, { sig: significado.value.trim() });
        });
        caja.appendChild(significado);

        caja.appendChild(crearElemento("div", "vocab-formas", r.formas.join(", ") + (r.refs.length ? "  ·  " + r.refs.join("; ") : "")));
        caja.appendChild(enlaceLogeion(r));

        const botones = crearElemento("div", "acciones-finales");

        if (repaso.modo === "sm2") {

            engadirBotonsEspaciados(botones, r);

        } else {

        botones.appendChild(crearBoton("Repetir", "boton-secundario", function() {
            actualizarDatoVocab(r.clave, { est: "aprendiendo" });
            repaso.cola.push(repaso.cola.shift());
            repaso.visible = false;
            pintarRepaso();
        }));

        botones.appendChild(crearBoton("Sabida", "", function() {
            actualizarDatoVocab(r.clave, { est: "sabida" });
            repaso.cola.shift();
            repaso.feitas++;
            repaso.visible = false;
            pintarRepaso();
        }));

        }

        caja.appendChild(botones);

    }

    caja.appendChild(crearBoton("Saír do repaso", "boton-secundario boton-pequeno", function() {
        repaso = null;
        pintarRepaso();
        pintarVocabulario();
    }));

}


// EXPORTAR VOCABULARIO (CSV para Anki/follas de cálculo ou PDF)

function descargarArchivo(nombre, mime, contenido) {

    const archivo = new Blob([contenido], { type: mime + ";charset=utf-8" });
    const enlace = document.createElement("a");

    enlace.href = URL.createObjectURL(archivo);
    enlace.download = nombre;

    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();

    setTimeout(function() { URL.revokeObjectURL(enlace.href); }, 1000);

}

function exportarVocabulario(formato) {

    const lista = vocabularioFiltrado().lista;

    if (lista.length === 0) {
        alert("Non hai vocabulario para exportar con estes filtros.");
        return;
    }

    if (formato === "pdf") {

        const filas = lista.map(function(r) {
            const dato = vocabulario[r.clave] || {};
            return "<tr><td class=\"lema\">" + escaparHtml(r.lema) + "</td><td>" +
                escaparHtml(CATEGORIAS[r.cat] || r.cat) + "</td><td>" +
                escaparHtml(dato.sig || "") + "</td><td class=\"formas\">" +
                escaparHtml(r.formas.join(", ")) + "</td><td class=\"num\">" + r.n + "</td></tr>";
        }).join("");

        imprimirComoPdf("Vocabulario",
            "<h1>Vocabulario</h1><table class=\"vocab\"><thead><tr><th>Lema</th><th>Categoría</th><th>Significado</th><th>Formas</th><th>Veces</th></tr></thead><tbody>" +
            filas + "</tbody></table>");

        return;

    }

    function celda(valor) {
        return "\"" + String(valor == null ? "" : valor).replace(/"/g, "\"\"") + "\"";
    }

    const lineas = [["Lema", "Significado", "Categoría", "Formas", "Veces", "Estado", "Referencias"].map(celda).join(",")];

    lista.forEach(function(r) {
        const dato = vocabulario[r.clave] || {};
        lineas.push([r.lema, dato.sig || "", CATEGORIAS[r.cat] || r.cat, r.formas.join(", "), r.n,
            ETIQUETAS_VOCAB[estadoVocab(r.clave)], r.refs.join("; ")].map(celda).join(","));
    });

    // BOM para que Excel respete os acentos e o grego
    descargarArchivo("vocabulario.csv", "text/csv", "\ufeff" + lineas.join("\r\n"));

}


// EXPORTAR A PDF (abre o diálogo de impresión: elixe «Gardar como PDF»)

const ESTILO_PDF =
    "@page{margin:18mm}" +
    "body{font:12pt/1.55 'Gentium Plus','Gentium Book Plus','Palatino Linotype',Georgia,serif;color:#111;margin:0}" +
    "h1{font-size:20pt;margin:0 0 4mm}h2{font-size:14pt;margin:8mm 0 2mm;break-after:avoid}" +
    "h3{font:600 8.5pt sans-serif;letter-spacing:.1em;text-transform:uppercase;color:#666;margin:0 0 1.5mm}" +
    ".subtitulo{color:#555;font-style:italic;margin:0 0 6mm}" +
    "section{border-top:.4pt solid #aaa;padding-top:2mm;margin-top:5mm}" +
    ".par{display:grid;grid-template-columns:1fr 1fr;gap:8mm}.par p{white-space:pre-wrap;margin:0}" +
    ".notas{font-size:10pt;color:#333;margin-top:3mm}.notas ul{margin:1mm 0 0;padding-left:5mm}" +
    "table.vocab{width:100%;border-collapse:collapse;font-size:11pt}" +
    "table.vocab th{font:600 8.5pt sans-serif;text-transform:uppercase;letter-spacing:.06em;text-align:left;color:#666;border-bottom:.6pt solid #999;padding:1mm 2mm}" +
    "table.vocab td{border-bottom:.3pt solid #ddd;padding:1.2mm 2mm;vertical-align:top}table.vocab tr{break-inside:avoid}" +
    "td.lema{font-weight:700;font-style:italic}td.formas{color:#555;font-size:10pt}td.num{text-align:right;color:#777}";

function imprimirComoPdf(titulo, corpoHtml) {

    const marco = document.createElement("iframe");

    marco.setAttribute("aria-hidden", "true");
    marco.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
    document.body.appendChild(marco);

    const doc = marco.contentWindow.document;

    doc.open();
    doc.write("<!DOCTYPE html><html lang=\"gl\"><head><meta charset=\"utf-8\"><title>" + escaparHtml(titulo) +
        "</title><style>" + ESTILO_PDF + "</style></head><body>" + corpoHtml + "</body></html>");
    doc.close();

    const tituloAnterior = document.title;

    function limpar() {
        document.title = tituloAnterior;
        marco.remove();
    }

    setTimeout(function() {
        document.title = titulo;   // o navegador suxire este nome para o ficheiro PDF
        marco.contentWindow.addEventListener("afterprint", limpar);
        marco.contentWindow.focus();
        marco.contentWindow.print();
        setTimeout(function() { document.title = tituloAnterior; }, 1000);
    }, 300);

}

function exportarPdf(fragmentos, nodo) {

    const primero = fragmentos[0];
    const titulo = [primero.autor, primero.obra, nodo.nombre].filter(function(x, i, a) { return x && a.indexOf(x) === i; }).join(" · ");

    const cuerpo = fragmentos.map(function(t) {

        const notas = notasDePalabras(t).map(function(n) {
            return "<li><em>" + escaparHtml(n[0]) + "</em>: " + escaparHtml(n[1]) + "</li>";
        }).join("");

        return "<section><h2>" + escaparHtml([t.subdivision, t.referencia].filter(Boolean).join(", ") || t.obra) + "</h2>" +
            "<div class=\"par\"><div><h3>Texto orixinal</h3><p>" + escaparHtml(t.textoOriginal) + "</p></div>" +
            "<div><h3>Tradución</h3><p>" + escaparHtml(t.traduccion) + "</p></div></div>" +
            (t.notaFragmento ? "<div class=\"notas\"><h3>Notas do fragmento</h3><p>" + escaparHtml(t.notaFragmento) + "</p></div>" : "") +
            (notas ? "<div class=\"notas\"><h3>Notas de palabras</h3><ul>" + notas + "</ul></div>" : "") +
            "</section>";

    }).join("");

    // Vocabulario con significado dos lemas destes fragmentos
    const lemas = new Map();

    fragmentos.forEach(function(t) {
        if (!tieneVocabulario(t)) return;
        t.vocabulario.forEach(function(e) {
            const clave = claveVocab(t.idioma, e.l);
            const dato = vocabulario[clave];
            if (dato && dato.sig && !lemas.has(clave)) lemas.set(clave, { lema: e.l, cat: e.c, sig: dato.sig });
        });
    });

    let vocab = "";

    if (lemas.size > 0) {
        const filas = Array.from(lemas.values())
            .sort(function(a, b) { return simplificar(a.lema).localeCompare(simplificar(b.lema)); })
            .map(function(e) {
                return "<tr><td class=\"lema\">" + escaparHtml(e.lema) + "</td><td>" + escaparHtml(CATEGORIAS[e.cat] || e.cat) +
                    "</td><td>" + escaparHtml(e.sig) + "</td></tr>";
            }).join("");
        vocab = "<h2 style=\"break-before:page\">Vocabulario</h2><table class=\"vocab\"><tbody>" + filas + "</tbody></table>";
    }

    imprimirComoPdf(titulo, "<h1>" + escaparHtml(titulo) + "</h1><p class=\"subtitulo\">" +
        fragmentos.length + (fragmentos.length === 1 ? " fragmento" : " fragmentos") + "</p>" + cuerpo + vocab);

}


// Fusión do vocabulario na sincronización: gaña o dato máis recente de cada lema
function fusionarVocabulario(locais, remotos) {

    const resultado = Object.assign({}, remotos);

    Object.keys(locais).forEach(function(k) {
        const a = locais[k], b = resultado[k];
        if (!b || (Date.parse(a.f) || 0) >= (Date.parse(b.f) || 0)) resultado[k] = a;
    });

    return resultado;

}


// PAPELEIRA (os textos eliminados poden recuperarse durante 30 días neste navegador)

const DIAS_PAPELERA = 30;
const MAX_PAPELERA = 300;

let papelera = [];   // [{ texto, fecha }]

try {
    papelera = JSON.parse(localStorage.getItem("bibliotecaPapelera")) || [];
} catch (e) {
    papelera = [];
}

function guardarPapelera() {

    try {
        localStorage.setItem("bibliotecaPapelera", JSON.stringify(papelera));
    } catch (e) {}

}

function depurarPapelera() {

    const limite = Date.now() - DIAS_PAPELERA * 86400000;

    papelera = papelera.filter(function(entrada) {
        return entrada && entrada.texto && Date.parse(entrada.fecha) >= limite;
    }).slice(-MAX_PAPELERA);

}

function actualizarBotonPapelera() {

    const boton = document.getElementById("botonPapelera");

    depurarPapelera();

    boton.textContent = "Papeleira (" + papelera.length + ")";
    boton.classList.toggle("oculto", papelera.length === 0);

}

// Elimina os textos (marcándoos tamén para a sincronización) e ofrece desfacer
function eliminarTextos(ids, mensaje) {

    guardarTraduccionPendiente();

    const fecha = new Date().toISOString();
    const eliminadosAhora = textos.filter(function(t) { return ids.indexOf(t.id) !== -1; });

    eliminadosAhora.forEach(function(texto) { papelera.push({ texto: texto, fecha: fecha }); });
    depurarPapelera();
    guardarPapelera();

    ids.forEach(marcarEliminado);

    textos = textos.filter(function(t) { return ids.indexOf(t.id) === -1; });

    if (textoActual && ids.indexOf(textoActual.id) !== -1) {
        textoActual = null;
    }

    guardarBiblioteca();
    mostrarBiblioteca();

    avisar(mensaje, {
        etiqueta: "Desfacer",
        funcion: function() {
            restaurarDePapelera(ids);
            mostrarBiblioteca();
        }
    });

}

function restaurarDePapelera(ids) {

    const ahora = new Date().toISOString();
    let restaurados = 0;

    papelera = papelera.filter(function(entrada) {

        if (ids.indexOf(entrada.texto.id) === -1) return true;

        if (!textos.some(function(t) { return t.id === entrada.texto.id; })) {
            // Data nova: así gaña á marca de borrado na sincronización
            entrada.texto.fechaModificacion = ahora;
            textos.push(entrada.texto);
            restaurados++;
        }

        delete eliminados[entrada.texto.id];
        return false;

    });

    try {
        localStorage.setItem("bibliotecaEliminados", JSON.stringify(eliminados));
    } catch (e) {}

    guardarPapelera();
    guardarBiblioteca();

    return restaurados;

}

function mostrarPapelera() {

    guardarTraduccionPendiente();
    depurarPapelera();

    mostrarPantalla("pantallaPapelera");
    pintarPapelera();

}

function pintarPapelera() {

    const lista = document.getElementById("listaPapelera");

    lista.replaceChildren();

    document.getElementById("resumenPapelera").textContent = papelera.length
        ? papelera.length + (papelera.length === 1 ? " texto" : " textos") + " na papeleira. Consérvanse " + DIAS_PAPELERA + " días neste navegador."
        : "";

    document.getElementById("accionsPapelera").classList.toggle("oculto", papelera.length === 0);

    if (papelera.length === 0) {
        const vacio = crearElemento("div", "vacio");
        vacio.appendChild(crearElemento("h3", "", "A papeleira está baleira"));
        vacio.appendChild(crearElemento("p", "", "Os textos que elimines poderás recuperalos aquí."));
        lista.appendChild(vacio);
        return;
    }

    papelera.slice().reverse().forEach(function(entrada) {

        const t = entrada.texto;
        const fila = crearElemento("div", "fila-papelera");
        const datos = crearElemento("div", "papelera-datos");

        datos.appendChild(crearElemento("strong", "", [t.autor, t.obra, t.subdivision, t.referencia].filter(Boolean).join(" · ")));
        datos.appendChild(crearElemento("span", "papelera-meta",
            "Eliminado o " + formatoFecha(entrada.fecha) + (t.traduccion ? " · con tradución" : "")));

        const fragmento = String(t.textoOriginal || "");
        datos.appendChild(crearElemento("span", "papelera-previa", fragmento.length > 110 ? fragmento.slice(0, 110) + "…" : fragmento));

        fila.appendChild(datos);

        fila.appendChild(crearBoton("Restaurar", "boton-secundario boton-pequeno", function() {
            restaurarDePapelera([t.id]);
            pintarPapelera();
            actualizarBotonPapelera();
            avisar("Texto restaurado.");
        }));

        fila.appendChild(crearBoton("Eliminar para sempre", "boton-peligro boton-pequeno", function() {

            if (!confirm("Eliminar definitivamente este texto? Non se poderá recuperar.")) return;

            papelera = papelera.filter(function(e) { return e !== entrada; });
            guardarPapelera();
            pintarPapelera();
            actualizarBotonPapelera();

        }));

        lista.appendChild(fila);

    });

}

function restaurarTodoPapelera() {

    const n = restaurarDePapelera(papelera.map(function(e) { return e.texto.id; }));

    pintarPapelera();
    actualizarBotonPapelera();
    avisar(n + (n === 1 ? " texto restaurado." : " textos restaurados."));

}

function baleirarPapelera() {

    if (!confirm("Baleirar a papeleira? Os textos eliminarase definitivamente.")) return;

    papelera = [];
    guardarPapelera();
    pintarPapelera();
    actualizarBotonPapelera();

}

function formatoFecha(iso) {

    const fecha = new Date(iso);

    return isNaN(fecha) ? "" : fecha.toLocaleString("gl-ES", { dateStyle: "short", timeStyle: "short" });

}


// HISTORIAL DE VERSIÓNS DA TRADUCIÓN

const MAX_VERSIONES = 8;
const INTERVALO_VERSION_MS = 5 * 60 * 1000;

// Garda o contido anterior antes de cambialo. Se xa hai unha versión recente non engade
// outra (así o historial non se enche mentres escribes); «forzar» ignora ese límite.
function guardarVersionAnterior(texto, anterior, forzar) {

    if (!anterior || !anterior.trim()) return;

    if (!Array.isArray(texto.versiones)) texto.versiones = [];

    const ultima = texto.versiones[texto.versiones.length - 1];

    if (ultima && ultima.t === anterior) return;
    if (!forzar && ultima && Date.now() - Date.parse(ultima.f) < INTERVALO_VERSION_MS) return;

    texto.versiones.push({ f: new Date().toISOString(), t: anterior });

    while (texto.versiones.length > MAX_VERSIONES) texto.versiones.shift();

}

// Un só punto onde se aplican os cambios do fragmento aberto (gardado manual e automático)
let idCamposCargados = null;   // id do texto cuxos campos están realmente cargados na pantalla

function aplicarCambiosFragmento(valor, nota) {

    // Seguranza: non gardar nunca o contido dos campos se non pertence ao texto aberto
    if (!textoActual || idCamposCargados !== textoActual.id) return;

    const anterior = textoActual.traduccion || "";

    if (valor.trim() !== anterior.trim()) {
        guardarVersionAnterior(textoActual, anterior, false);
        if (valor.trim()) registrarActividad(textoActual.id);
    }

    textoActual.traduccion = valor;
    textoActual.notaFragmento = nota;
    textoActual.fechaModificacion = new Date().toISOString();

    actualizarEstadoAutomatico();
    guardarBiblioteca();
    pintarHistorial();

}

function pintarHistorial() {

    const caja = document.getElementById("historialTraduccion");
    const lista = document.getElementById("listaVersiones");
    const versiones = (textoActual && textoActual.versiones) || [];

    caja.classList.toggle("oculto", versiones.length === 0);
    document.getElementById("resumenHistorial").textContent = "Versións anteriores (" + versiones.length + ")";

    lista.replaceChildren();

    versiones.slice().reverse().forEach(function(version) {

        const fila = crearElemento("div", "version");

        fila.appendChild(crearElemento("div", "version-fecha", "Ata o " + formatoFecha(version.f)));
        fila.appendChild(crearElemento("p", "version-texto", version.t.length > 500 ? version.t.slice(0, 500) + "…" : version.t));
        fila.appendChild(crearBoton("Restaurar esta versión", "boton-secundario boton-pequeno", function() {
            restaurarVersion(version.f);
        }));

        lista.appendChild(fila);

    });

}

function restaurarVersion(fecha) {

    if (modoEstudo || !textoActual) return;

    const version = (textoActual.versiones || []).find(function(v) { return v.f === fecha; });

    if (!version) return;

    const campo = document.getElementById("campoTraduccion");

    guardarVersionAnterior(textoActual, campo.value, true);   // o texto actual tamén se conserva

    campo.value = version.t;
    guardarTraduccionPendiente();

    avisar("Versión restaurada. A anterior segue no historial.");

}


// ACTIVIDADE DIARIA (fragmentos traballados por día e racha)

let actividad = {};   // "2026-11-08" -> [ids dos fragmentos traballados]

try {
    actividad = JSON.parse(localStorage.getItem("bibliotecaActividade")) || {};
} catch (e) {
    actividad = {};
}

function claveDia(fecha) {

    return fecha.getFullYear() + "-" + String(fecha.getMonth() + 1).padStart(2, "0") + "-" + String(fecha.getDate()).padStart(2, "0");

}

function registrarActividad(id) {

    const dia = claveDia(new Date());

    if (!Array.isArray(actividad[dia])) actividad[dia] = [];

    if (actividad[dia].indexOf(id) !== -1) return;

    actividad[dia].push(id);

    // Só se conserva o último ano
    const limite = claveDia(new Date(Date.now() - 366 * 86400000));
    Object.keys(actividad).forEach(function(d) { if (d < limite) delete actividad[d]; });

    try {
        localStorage.setItem("bibliotecaActividade", JSON.stringify(actividad));
    } catch (e) {}

}

function diasConActividad(fecha) {

    return (actividad[claveDia(fecha)] || []).length;

}

// Días seguidos con actividade (se hoxe aínda non traballaches, conta desde onte)
function calcularRacha() {

    const dia = new Date();
    let racha = 0;

    if (!diasConActividad(dia)) dia.setDate(dia.getDate() - 1);

    while (diasConActividad(dia)) {
        racha++;
        dia.setDate(dia.getDate() - 1);
    }

    return racha;

}

function crearChipActividad() {

    const hoy = diasConActividad(new Date());
    const racha = calcularRacha();

    if (!hoy && !racha) return null;

    return crearElemento("span", "chip-actividad",
        "Hoxe: " + hoy + (hoy === 1 ? " fragmento" : " fragmentos") +
        " · racha de " + racha + (racha === 1 ? " día" : " días"));

}


// SEGUINTE FRAGMENTO PENDENTE

function irAlSiguientePendiente() {

    if (!textoActual) return;

    guardarTraduccionPendiente();

    const orden = aplanarArbol(construirArbol(textos));
    const indice = orden.findIndex(function(t) { return t.id === textoActual.id; });
    const candidatos = orden.slice(indice + 1).concat(orden.slice(0, Math.max(indice, 0)));
    const destino = candidatos.find(function(t) { return estadoDe(t) === "pendiente"; });

    if (!destino) {
        avisar("Non quedan fragmentos pendentes.");
        return;
    }

    abrirTexto(destino.id);

}


// VOCABULARIO A MAN (funciona sen CLTK)

function engadirVocabManual(idioma, lema, significado, contexto) {

    lema = String(lema || "").trim();

    if (!lema) return false;

    const clave = claveVocab(idioma, lema);
    const previo = vocabulario[clave] || {};

    actualizarDatoVocab(clave, {
        sig: String(significado || "").trim() || previo.sig || "",
        man: Object.assign({}, previo.man, { lema: lema, idioma: idioma }, contexto || {})
    });

    return true;

}

// Ao abrir a nota dunha palabra: propón o lema (de CLTK se hai análise) e o significado xa gardado
function prepararVocabRapido(palabra, indice) {

    if (!textoActual) return;

    const analisis = analisisActual && analisisActual[indice];
    const lema = analisis && analisis.lema ? analisis.lema : palabra.textContent;
    const gardado = vocabulario[claveVocab(textoActual.idioma, lema)] || {};

    document.getElementById("vocabRapidoLema").value = lema;
    document.getElementById("vocabRapidoSig").value = gardado.sig || "";
    document.getElementById("vocabRapido").open = false;

}

function gardarVocabRapido() {

    if (!textoActual) return;

    const lema = document.getElementById("vocabRapidoLema").value.trim();
    const palabra = contenedorPalabras.querySelector("[data-indice=\"" + palabraSeleccionada + "\"]");

    if (!lema) {
        avisar("Escribe o lema da palabra.");
        return;
    }

    engadirVocabManual(textoActual.idioma, lema, document.getElementById("vocabRapidoSig").value, {
        forma: palabra ? palabra.textContent : "",
        obra: textoActual.autor + " · " + textoActual.obra,
        ref: textoActual.referencia || ""
    });

    avisar("«" + lema + "» engadido ao vocabulario.");

}

function engadirVocabDesdeFormulario() {

    const lema = document.getElementById("vocabNuevoLema");
    const significado = document.getElementById("vocabNuevoSig");

    if (!engadirVocabManual(document.getElementById("vocabNuevoIdioma").value, lema.value, significado.value)) {
        avisar("Escribe o lema.");
        lema.focus();
        return;
    }

    avisar("«" + lema.value.trim() + "» engadido.");

    lema.value = "";
    significado.value = "";
    lema.focus();

    pintarVocabulario();

}

function quitarVocabManual(clave) {

    actualizarDatoVocab(clave, { man: null });
    pintarVocabulario();

}


// CÓDIGO DE CORES GRAMATICAIS (subliñado continuo = caso; discontinuo = palabra invariable)

let coloresActivos = true;
let categoriaResaltada = null;

try {
    coloresActivos = localStorage.getItem("bibliotecaColores") !== "0";
} catch (e) {}

// Ordenadas como aparecen na lenda
// AXUSTES DE LECTURA (cada axuda pódese acender ou apagar)

const AXUSTES_BASE = { modoColor: "ambos", concordanciaModo: "xn", concordancia: true, funcionCaso: true, rexencia: true, pasaxes: true };
const axustes = Object.assign({}, AXUSTES_BASE);

try {
    Object.assign(axustes, JSON.parse(localStorage.getItem("bibliotecaAxustes")) || {});
} catch (e) {}

function gardarAxustes() {
    try { localStorage.setItem("bibliotecaAxustes", JSON.stringify(axustes)); } catch (e) {}
}

// Palabras que se declinan: a cor indica o CASO. Palabras invariables (verbos, adverbios,
// preposicións, conxuncións…): a cor indica a CLASE de palabra, con subliñado discontinuo.
const CASOS_COR = ["nominative", "vocative", "accusative", "genitive", "dative", "ablative", "locative"];
const ABREVIATURAS_CASO = { nom: "nominative", voc: "vocative", acc: "accusative", gen: "genitive",
                            dat: "dative", abl: "ablative", loc: "locative" };

const ORDE_CATEGORIAS = CASOS_COR.map(function(c) { return "caso-" + c; })
    .concat(["verb", "aux", "adv", "adp", "cconj", "sconj", "noun", "propn", "adj", "pron", "det", "num", "part", "intj", "x"]);

// Devolve o caso da palabra («nominative», «genitive»…) ou null se non se declina / a análise non o indica
function casoDe(analisis) {

    const rasgos = rasgosDe(analisis);
    const clave = Object.keys(rasgos).find(function(k) { return k.toLowerCase() === "case"; });

    if (!clave) return null;

    const valores = String(rasgos[clave]).toLowerCase().split(/[,/|;\s]+/).filter(Boolean);

    for (let i = 0; i < valores.length; i++) {
        const v = ABREVIATURAS_CASO[valores[i]] || valores[i];
        if (CASOS_COR.indexOf(v) !== -1) return v;
    }

    return null;

}

// Clave de cor: «caso-genitive» para as palabras declinables, ou a clase («verb», «adv»…) para o resto
function categoriaDe(analisis) {

    if (!analisis) return null;

    const caso = axustes.modoColor === "clases" ? null : casoDe(analisis);

    if (caso) return "caso-" + caso;

    if (axustes.modoColor === "casos") return null;

    return analisis.categoria ? String(analisis.categoria).toLowerCase() : null;

}

function nomeCor(clave) {

    if (String(clave).indexOf("caso-") === 0) {
        const caso = clave.slice(5);
        return (VALORES_RASGO[caso] || caso) + " (caso)";
    }

    return CATEGORIAS[clave] || clave;

}

function aplicarColoresGramatica() {

    const activo = coloresActivos && Boolean(analisisActual);
    const presentes = new Map();

    contenedorPalabras.classList.toggle("con-colores", activo);

    contenedorPalabras.querySelectorAll(".palabra").forEach(function(palabra) {

        const cat = categoriaDe(analisisActual && analisisActual[Number(palabra.dataset.indice)]);

        if (cat) {
            palabra.dataset.cat = cat;
            presentes.set(cat, (presentes.get(cat) || 0) + 1);
        } else {
            delete palabra.dataset.cat;
        }

        const forma = cat ? formaVerbalDe(analisisActual && analisisActual[Number(palabra.dataset.indice)]) : null;

        if (forma) palabra.dataset.forma = forma;
        else delete palabra.dataset.forma;

        palabra.setAttribute("aria-label", etiquetaPalabra(palabra));

    });

    marcarRexencia(activo);

    if (categoriaResaltada && !presentes.has(categoriaResaltada)) categoriaResaltada = null;

    contenedorPalabras.querySelectorAll(".palabra").forEach(function(p) {
        p.setAttribute("aria-label", etiquetaPalabra(p));
    });

    pintarLeyendaColores(activo ? presentes : new Map());
    aplicarResaltadoCategoria();
    actualizarBotonColores();

}

function pintarLeyendaColores(presentes) {

    const leyenda = document.getElementById("leyendaColores");

    leyenda.replaceChildren();
    leyenda.classList.toggle("oculto", presentes.size === 0);

    Array.from(presentes.keys())
        .sort(function(a, b) {
            const i = ORDE_CATEGORIAS.indexOf(a), j = ORDE_CATEGORIAS.indexOf(b);
            return (i === -1 ? 99 : i) - (j === -1 ? 99 : j);
        })
        .forEach(function(cat) {

            const chip = crearBoton(nomeCor(cat) + " · " + presentes.get(cat), "chip-leyenda", function() {
                categoriaResaltada = categoriaResaltada === cat ? null : cat;
                aplicarResaltadoCategoria();
                pintarEstadoLeyenda();
            });

            chip.dataset.cat = cat;
            chip.title = "Resaltar só: " + nomeCor(cat);
            leyenda.appendChild(chip);

        });

    if (presentes.size > 0) {
        leyenda.appendChild(crearElemento("span", "nota-leyenda",
            "Subliñado: continuo = caso · discontinuo = palabra invariable · punteado = infinitivo · dobre = xerundio ou supino · ondulado = participio"));
    }

    pintarEstadoLeyenda();

}

function pintarEstadoLeyenda() {

    document.querySelectorAll("#leyendaColores .chip-leyenda").forEach(function(chip) {
        chip.setAttribute("aria-pressed", String(chip.dataset.cat === categoriaResaltada));
    });

}

// Co filtro activo, as demais categorías quedan atenuadas
function aplicarResaltadoCategoria() {

    contenedorPalabras.querySelectorAll(".palabra").forEach(function(palabra) {
        palabra.classList.toggle("atenuada", Boolean(categoriaResaltada) && palabra.dataset.cat !== categoriaResaltada);
    });

}

function actualizarBotonColores() {

    const boton = document.getElementById("botonColores");

    boton.setAttribute("aria-pressed", String(coloresActivos));
    boton.textContent = coloresActivos ? "Cores: sí" : "Cores: non";

}

function alternarColores() {

    coloresActivos = !coloresActivos;

    try { localStorage.setItem("bibliotecaColores", coloresActivos ? "1" : "0"); } catch (e) {}

    aplicarColoresGramatica();

    if (coloresActivos && !analisisActual) {
        avisar("Preme «Analizar» para ver as cores gramaticais.");
    }

}

// Ao fixar unha palabra, márcanse as demais formas co mesmo lema
function marcarMismoLema(palabra) {

    contenedorPalabras.querySelectorAll(".mismo-lema").forEach(function(p) {
        p.classList.remove("mismo-lema");
    });

    if (!palabra || !analisisActual) return;

    const lema = (analisisActual[Number(palabra.dataset.indice)] || {}).lema;

    if (!lema) return;

    contenedorPalabras.querySelectorAll(".palabra").forEach(function(p) {

        const otro = analisisActual[Number(p.dataset.indice)];

        if (p !== palabra && otro && otro.lema && otro.lema.toLowerCase() === lema.toLowerCase()) {
            p.classList.add("mismo-lema");
        }

    });

}

// Pechar o editor fixo ao facer clic fóra (se non hai cambios sen gardar na nota)
document.addEventListener("click", function(evento) {

    if (editorNota.classList.contains("oculto") || !editorFixado || palabraSeleccionada === null) return;
    if (editorNota.contains(evento.target) || evento.target.closest(".palabra, button, a, select, input, textarea, summary, dialog")) return;

    const gardada = (textoActual && textoActual.notasPalabras[palabraSeleccionada]) || "";

    if (document.getElementById("campoNotaPalabra").value.trim() !== gardada.trim()) return;

    cerrarEditorNota(false);

});

// Escape pecha o editor aínda que non teña o foco (o clic xa non o leva ao campo)
document.addEventListener("keydown", function(evento) {

    if (evento.key !== "Escape" || editorNota.classList.contains("oculto") || editorNota.contains(evento.target)) return;
    if (document.getElementById("axuda").open) return;

    cerrarEditorNota(true);

});



// ====================== AXUDAS DE LECTURA ======================

function valoresRasgo(a, nome) {

    const rasgos = rasgosDe(a);
    const clave = Object.keys(rasgos).find(function(k) { return k.toLowerCase() === nome; });

    if (!clave) return [];

    return String(rasgos[clave]).toLowerCase().split(/[,/|;\s]+/).filter(Boolean);

}

function nomeCaso(caso) {

    return VALORES_RASGO[caso] || caso;

}

// Estilo de subliñado segundo a forma verbal: infinitivo, xerundio/supino, participio
function formaVerbalDe(a) {

    if (!a) return null;

    const v = valoresRasgo(a, "verbform").join(" ");

    if (/partic|^part$/.test(v)) return "participio";
    if (/infin|^inf$/.test(v)) return "infinitivo";
    if (/gerund|gdv|supin/.test(v)) return "xerundio";

    return null;

}

// --- Caso que rexe cada preposición (heurística: primeira palabra con caso rexido nas 3 seguintes)
const CASOS_REXIDOS = { accusative: "ac.", ablative: "ab.", genitive: "xen.", dative: "dat." };

function marcarRexencia(activo) {

    const lista = Array.from(contenedorPalabras.querySelectorAll(".palabra"));

    lista.forEach(function(p, i) {

        p.removeAttribute("data-rexe");
        p.removeAttribute("data-rexe-abr");
        p.removeAttribute("data-rexe-palabra");
        p.style.removeProperty("--rexe");

        const a = analisisActual && analisisActual[Number(p.dataset.indice)];

        if (!activo || !axustes.rexencia || !a || String(a.categoria || "").toLowerCase() !== "adp") return;

        for (let j = i + 1; j < Math.min(i + 4, lista.length); j++) {

            const b = analisisActual[Number(lista[j].dataset.indice)];
            const cat = b && String(b.categoria || "").toLowerCase();

            if (cat === "verb" || cat === "aux" || cat === "adp") break;

            const caso = b && casoDe(b);

            if (caso && CASOS_REXIDOS[caso]) {
                p.dataset.rexe = caso;
                p.dataset.rexeAbr = CASOS_REXIDOS[caso];
                p.dataset.rexePalabra = lista[j].textContent;
                p.style.setProperty("--rexe", "var(--k-" + caso + ")");
                break;
            }

        }

    });

}

// --- Concordancia: mesmo caso e, se se coñecen, número e xénero compatibles
function compatibles(x, y) {

    return x.length === 0 || y.length === 0 || x.some(function(v) { return y.indexOf(v) !== -1; });

}

function palabrasConcordantes(palabra) {

    const a = analisisActual && analisisActual[Number(palabra.dataset.indice)];

    if (!a) return [];

    const conCaso = axustes.concordanciaModo === "cxn";
    const casos = valoresRasgo(a, "case");
    const numero = valoresRasgo(a, "number");
    const xenero = valoresRasgo(a, "gender");

    // Sen xénero nin número non hai con que comparar
    if (numero.length === 0 && xenero.length === 0) return [];

    return Array.from(contenedorPalabras.querySelectorAll(".palabra")).filter(function(p) {

        if (p === palabra) return false;

        const b = analisisActual[Number(p.dataset.indice)];

        if (!b) return false;

        const casosB = valoresRasgo(b, "case");
        const numeroB = valoresRasgo(b, "number");
        const xeneroB = valoresRasgo(b, "gender");

        // Só palabras que se declinan (as formas verbais conxugadas teñen número pero non xénero nin caso)
        if (casosB.length === 0 && xeneroB.length === 0) return false;

        if (conCaso && !(casos.length && casosB.length && compatibles(casos, casosB))) return false;

        // Cada trazo que se coñece nas dúas palabras ten que coincidir, e polo menos un ten que compararse
        let comparados = 0;

        if (xenero.length && xeneroB.length) {
            if (!compatibles(xenero, xeneroB)) return false;
            comparados++;
        }

        if (numero.length && numeroB.length) {
            if (!compatibles(numero, numeroB)) return false;
            comparados++;
        }

        return comparados > 0;

    });

}

function marcarConcordancia(palabra) {

    contenedorPalabras.querySelectorAll(".concuerda").forEach(function(p) { p.classList.remove("concuerda"); });

    if (!palabra || !axustes.concordancia) return;

    palabrasConcordantes(palabra).forEach(function(p) { p.classList.add("concuerda"); });

}

// --- Función habitual de cada caso
const FUNCIONS_CASO = {
    latin: {
        nominative: ["suxeito", "atributo ou predicado nominal", "aposición do suxeito"],
        vocative: ["chamada directa a alguén"],
        accusative: ["complemento directo", "dirección (ad, in + acusativo)", "extensión de tempo ou espazo", "suxeito dun infinitivo", "rexido por moitas preposicións (ad, ante, apud, per, post…)"],
        genitive: ["posesión", "partitivo", "obxectivo ou subxectivo", "cualidade ou descrición", "complemento de adxectivos e verbos (memini, oblivior…)"],
        dative: ["complemento indirecto", "posesor con sum", "axente co xerundivo", "interese (a favor ou en contra)", "fin"],
        ablative: ["instrumento ou medio", "causa", "modo", "axente con a / ab na pasiva", "separación ou orixe", "lugar onde (in + ablativo)", "tempo cando", "ablativo absoluto", "segundo termo da comparación"],
        locative: ["lugar onde (cidades, domi, rure…)"]
    },
    griego: {
        nominative: ["suxeito", "atributo ou predicado nominal"],
        vocative: ["chamada directa, a miúdo con ὦ"],
        accusative: ["complemento directo", "extensión de tempo ou espazo", "acusativo de relación (en canto a…)", "suxeito dun infinitivo", "dirección con preposición (εἰς, πρός…)"],
        genitive: ["posesión", "partitivo", "separación ou orixe (ἀπό, ἐκ)", "comparación", "tempo dentro do cal", "xenitivo absoluto (con participio)"],
        dative: ["complemento indirecto", "instrumento ou medio", "interese", "posesor (con εἰμί)", "tempo ou lugar «cando / onde»", "causa ou modo"],
        locative: ["lugar onde"]
    }
};

function funcionsDoCaso(caso) {

    const grupo = FUNCIONS_CASO[textoActual && textoActual.idioma === "griego" ? "griego" : "latin"];

    return grupo[caso] || [];

}

// Texto curto para o cadro que sae ao pasar o rato ou enfocar unha palabra
function axudaCaso(a, palabra) {

    const partes = [];
    const caso = casoDe(a);

    if (caso && axustes.funcionCaso) {
        partes.push(nomeCaso(caso) + ": " + funcionsDoCaso(caso).slice(0, 3).join(", "));
    }

    if (palabra.dataset.rexe && axustes.rexencia) {
        partes.push("Rexe " + nomeCaso(palabra.dataset.rexe).toLowerCase() + " (" + palabra.dataset.rexePalabra + ")");
    }

    return partes.join("\n");

}

// Bloque completo no editor de notas (tamén serve a quen non ve as cores)
function mostrarInfoCaso(indice) {

    const caja = document.getElementById("infoCaso");

    caja.replaceChildren();

    const a = analisisActual && analisisActual[indice];
    const palabra = palabraPorIndice(indice);
    let hai = false;

    function linea(titulo, texto) {
        const p = crearElemento("p", "info-caso-linea");
        p.appendChild(crearElemento("strong", "", titulo + " "));
        p.appendChild(document.createTextNode(texto));
        caja.appendChild(p);
        hai = true;
    }

    if (a && palabra) {

        const caso = casoDe(a);

        if (caso && axustes.funcionCaso) {
            linea(nomeCaso(caso) + ":", funcionsDoCaso(caso).join("; ") + ".");
        }

        if (palabra.dataset.rexe && axustes.rexencia) {
            linea("Preposición:", "rexe " + nomeCaso(palabra.dataset.rexe).toLowerCase() + " (" + palabra.dataset.rexePalabra + ").");
        }

        if (caso && axustes.concordancia) {
            const conc = palabrasConcordantes(palabra);
            if (conc.length) {
                linea(axustes.concordanciaModo === "cxn" ? "Concorda en caso, xénero e número con:" : "Mesmo xénero e número que:", conc.slice(0, 12).map(function(p) { return p.textContent; }).join(", ") + (conc.length > 12 ? "…" : ""));
            }
        }

    }

    caja.classList.toggle("oculto", !hai);

}

// --- Outros pasaxes da biblioteca co mesmo lema (usa o vocabulario xa analisado de cada texto)
function extractoPasaxe(texto, formas) {

    const buscadas = new Set(formas.map(simplificar));
    const contido = texto.textoOriginal || "";
    const expresion = /[\p{L}\p{M}]+(?:[’'][\p{L}\p{M}]+)*/gu;
    let m;

    while ((m = expresion.exec(contido)) !== null) {

        if (buscadas.has(simplificar(m[0]))) {

            return {
                antes: (m.index > 45 ? "…" : "") + contido.slice(Math.max(0, m.index - 45), m.index).replace(/\s+/g, " "),
                forma: m[0],
                despois: contido.slice(m.index + m[0].length, m.index + m[0].length + 45).replace(/\s+/g, " ") +
                    (m.index + m[0].length + 45 < contido.length ? "…" : "")
            };

        }

    }

    return null;

}

function atoparPasaxes(lema, idioma, excluirId) {

    const clave = String(lema).toLowerCase();
    const resultado = [];

    textos.forEach(function(t) {

        if (t.id === excluirId || t.idioma !== idioma || !Array.isArray(t.vocabulario)) return;

        const entrada = t.vocabulario.find(function(e) { return String(e.l).toLowerCase() === clave; });

        if (entrada) resultado.push({ texto: t, entrada: entrada });

    });

    return resultado;

}

function mostrarPasaxes(indice) {

    const caixa = document.getElementById("pasaxes");
    const lista = document.getElementById("listaPasaxes");
    const a = analisisActual && analisisActual[indice];

    lista.replaceChildren();

    if (!axustes.pasaxes || !a || !a.lema || !textoActual) {
        caixa.classList.add("oculto");
        return;
    }

    const atopados = atoparPasaxes(a.lema, textoActual.idioma, textoActual.id);

    caixa.classList.toggle("oculto", atopados.length === 0);

    document.getElementById("resumenPasaxes").textContent =
        "Outros pasaxes con «" + a.lema + "» (" + atopados.length + ")";

    atopados.slice(0, 8).forEach(function(r) {

        const boton = crearElemento("button", "pasaxe");
        const lugar = [r.texto.autor, r.texto.obra, r.texto.subdivision, r.texto.referencia].filter(Boolean).join(" · ");
        const extracto = extractoPasaxe(r.texto, r.entrada.f || []);

        boton.type = "button";
        boton.appendChild(crearElemento("span", "pasaxe-lugar", lugar));

        if (extracto) {
            const frase = crearElemento("span", "pasaxe-frase");
            frase.lang = r.texto.idioma === "griego" ? "grc" : "la";
            frase.appendChild(document.createTextNode(extracto.antes));
            frase.appendChild(crearElemento("mark", "", extracto.forma));
            frase.appendChild(document.createTextNode(extracto.despois));
            boton.appendChild(frase);
        }

        boton.addEventListener("click", function() { abrirTexto(r.texto.id); });
        lista.appendChild(boton);

    });

    if (atopados.length > 8) {
        lista.appendChild(crearElemento("p", "pasaxe-mais", "… e " + (atopados.length - 8) + " máis."));
    }

}

document.getElementById("pasaxes").addEventListener("toggle", function() {

    if (palabraSeleccionada === null) return;

    const palabra = palabraPorIndice(palabraSeleccionada);

    if (palabra) posicionarEditorNota(palabra);

});

// --- Repaso espaciado (SM-2)
const NOVAS_POR_SESION = 10;

function fechaLocalISO(d) {

    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

}

// calidade: 1 = non o sabía, 3 = difícil, 4 = ben, 5 = fácil
function sm2(dato, calidade) {

    let ef = dato.ef || 2.5;
    let rp = dato.rp || 0;
    let iv = dato.iv || 0;

    if (calidade < 3) {
        rp = 0;
        iv = 1;
    } else {
        rp++;
        iv = rp === 1 ? 1 : rp === 2 ? 6 : Math.round(iv * ef);
    }

    ef = Math.max(1.3, ef + 0.1 - (5 - calidade) * (0.08 + (5 - calidade) * 0.02));

    const proxima = new Date();
    proxima.setDate(proxima.getDate() + iv);

    return { ef: ef, rp: rp, iv: iv, pr: fechaLocalISO(proxima), est: iv >= 21 ? "sabida" : "aprendiendo" };

}

function textoIntervalo(dias) {

    if (dias <= 1) return "1 día";
    if (dias < 30) return dias + " días";

    return Math.round(dias / 30) + (Math.round(dias / 30) === 1 ? " mes" : " meses");

}

function colaEspaciada() {

    const hoxe = fechaLocalISO(new Date());
    const debidas = [];
    const novas = [];

    vocabularioFiltrado().lista.forEach(function(r) {

        const dato = vocabulario[r.clave] || {};

        if (dato.pr) {
            if (dato.pr <= hoxe) debidas.push(r);
        } else if (estadoVocab(r.clave) !== "sabida") {
            novas.push(r);
        }

    });

    debidas.sort(function(x, y) { return vocabulario[x.clave].pr < vocabulario[y.clave].pr ? -1 : 1; });

    return debidas.concat(novas.slice(0, NOVAS_POR_SESION));

}

function actualizarContaEspaciado() {

    const boton = document.getElementById("botonEspaciado");

    if (boton) boton.textContent = "Repaso espaciado (" + colaEspaciada().length + ")";

}

function empezarRepasoEspaciado() {

    const cola = colaEspaciada();

    if (cola.length === 0) {
        alert("Hoxe non tes palabras por repasar. Volve mañá ou engade vocabulario.");
        return;
    }

    repaso = { modo: "sm2", cola: cola, total: cola.length, feitas: 0, visible: false };

    pintarRepaso();

}

function engadirBotonsEspaciados(botones, r) {

    [["Non o sabía", 1], ["Difícil", 3], ["Ben", 4], ["Fácil", 5]].forEach(function(par) {

        const calidade = par[1];
        const previsto = sm2(vocabulario[r.clave] || {}, calidade);

        botones.appendChild(crearBoton(par[0] + " · " + textoIntervalo(previsto.iv), calidade === 1 ? "boton-secundario" : "", function() {

            actualizarDatoVocab(r.clave, sm2(vocabulario[r.clave] || {}, calidade));
            repaso.cola.shift();

            if (calidade < 3) repaso.cola.push(r);
            else repaso.feitas++;

            repaso.visible = false;
            pintarRepaso();

        }));

    });

}

// --- Aviso de copia de seguridade
function recordarCopia() {

    if (textos.length === 0) return;

    let ultima = 0;

    try {
        ultima = Number(localStorage.getItem("bibliotecaUltimaCopia")) || 0;

        if (!ultima) {
            localStorage.setItem("bibliotecaUltimaCopia", String(Date.now()));
            return;
        }
    } catch (e) {
        return;
    }

    const dias = Math.floor((Date.now() - ultima) / 86400000);

    if (dias >= 7) {
        setTimeout(function() {
            avisar("Leva " + dias + " días sen facer copia de seguridade.", { etiqueta: "Facer copia", funcion: exportarCopiaCompleta });
        }, 1500);
    }

}

// --- Panel de axustes
function iniciarAxustes() {

    const modo = document.getElementById("axusteModoColor");
    const caixas = {
        axusteConcordancia: "concordancia", axusteFuncionCaso: "funcionCaso",
        axusteRexencia: "rexencia", axustePasaxes: "pasaxes"
    };

    modo.value = axustes.modoColor;

    const modoConc = document.getElementById("axusteConcordanciaModo");

    modoConc.value = axustes.concordanciaModo;

    modoConc.addEventListener("change", function() {
        axustes.concordanciaModo = modoConc.value;
        gardarAxustes();

        if (palabraSeleccionada !== null) {
            const palabra = palabraPorIndice(palabraSeleccionada);
            marcarConcordancia(editorFixado ? palabra : null);
            mostrarInfoCaso(palabraSeleccionada);
        }
    });

    modo.addEventListener("change", function() {
        axustes.modoColor = modo.value;
        gardarAxustes();
        aplicarColoresGramatica();
    });

    Object.keys(caixas).forEach(function(id) {

        const caixa = document.getElementById(id);

        caixa.checked = Boolean(axustes[caixas[id]]);

        caixa.addEventListener("change", function() {

            axustes[caixas[id]] = caixa.checked;
            gardarAxustes();

            aplicarColoresGramatica();

            if (palabraSeleccionada !== null) {
                const palabra = palabraPorIndice(palabraSeleccionada);
                marcarConcordancia(editorFixado ? palabra : null);
                mostrarInfoCaso(palabraSeleccionada);
                mostrarPasaxes(palabraSeleccionada);
                if (palabra) posicionarEditorNota(palabra);
            }

        });

    });

}




// ====================== CONEXIÓNS PALABRA ↔ TRADUCIÓN ======================
// Modo conectar: o orixinal e a tradución pasan a dúas filas, unha enriba da outra, cun corredor no medio
// onde van as liñas. Así nunca se cruzan con outros elementos da páxina nin entre si (cada conexión ten o seu carril).

let modoConectar = false;
let selOrixe = new Set();   // índices de palabras do orixinal
let selTrad = new Set();    // índices de tokens da tradución
let tokensTrad = [];        // [{ i: inicio, f: fin, x: texto }]
let conexEditada = false;   // se o usuario escribiu a man nos campos, non se sobrescriben
const CORES_CONEXION = ["#2563eb", "#dc2626", "#15803d", "#ea580c", "#9333ea", "#0d9488", "#db2777", "#a16207"];
const filaOrixe = document.getElementById("filaOrixe");
const filaTrad = document.getElementById("filaTrad");

function tokenizarTraduccion(txt) {

    const re = /[\p{L}\p{M}\p{N}]+(?:['’\-][\p{L}\p{M}\p{N}]+)*/gu;
    const r = [];
    let m;

    while ((m = re.exec(txt)) !== null) r.push({ i: m.index, f: m.index + m[0].length, x: m[0] });

    return r;

}

function reiniciarConectar() {

    modoConectar = false;
    selOrixe.clear();
    selTrad.clear();
    conexEditada = false;
    document.body.classList.remove("modo-conectar");
    document.getElementById("mesaConectar").classList.add("oculto");
    document.getElementById("barraConectar").classList.add("oculto");
    filaOrixe.replaceChildren();
    filaTrad.replaceChildren();
    document.getElementById("lineasConexion").replaceChildren();

}

function alternarConectar() {

    if (!textoActual) return;

    if (modoConectar) {
        reiniciarConectar();
        document.getElementById("botonConectar").focus();
        return;
    }

    guardarTraduccionPendiente();

    if (!(textoActual.traduccion || "").trim()) {
        avisar("Escribe primeiro a tradución deste fragmento para poder conectala.");
        return;
    }

    cerrarEditorNota();
    modoConectar = true;
    document.body.classList.add("modo-conectar");
    document.getElementById("mesaConectar").classList.remove("oculto");
    document.getElementById("barraConectar").classList.remove("oculto");

    renderizarMesaConectar();
    document.querySelector("#mesaConectar .mesa-scroll").scrollLeft = 0;
    actualizarBarraConectar();
    document.querySelector("#mesaConectar .mesa-cabeceira button").focus();

}

function crearChipConexion(texto, atributo, valor, titulo) {

    const chip = crearElemento("button", "chip-conex", texto);

    chip.type = "button";
    chip.dataset[atributo] = String(valor);
    chip.setAttribute("aria-pressed", "false");
    if (titulo) chip.title = titulo;

    return chip;

}

function renderizarMesaConectar() {

    filaOrixe.replaceChildren();
    filaTrad.replaceChildren();
    filaOrixe.lang = textoActual.idioma === "griego" ? "grc" : "la";

    contenedorPalabras.querySelectorAll(".palabra").forEach(function(p) {

        const a = analisisActual && analisisActual[Number(p.dataset.indice)];
        const chip = crearChipConexion(p.textContent, "i", p.dataset.indice, a && a.lema ? "Lema: " + a.lema : "");
        const cor = coloresActivos && p.dataset.cat ? getComputedStyle(p).getPropertyValue("--cat").trim() : "";

        if (cor) chip.style.setProperty("--cat", cor);
        filaOrixe.appendChild(chip);

    });

    tokensTrad = tokenizarTraduccion(textoActual.traduccion || "");

    tokensTrad.forEach(function(t, k) { filaTrad.appendChild(crearChipConexion(t.x, "t", k)); });

    ajustarMesa();
    pintarConexions();

}

// Se as filas non caben no ancho dispoñible, redúcese a letra (ata 11 px) para evitar o desprazamento horizontal
function ajustarMesa() {

    const lienzo = document.getElementById("lienzoConex");
    const caixa = document.querySelector("#mesaConectar .mesa-scroll");

    lienzo.style.removeProperty("--tam-mesa");

    let tam = parseFloat(getComputedStyle(filaOrixe).fontSize) || 18;

    for (let k = 0; k < 3; k++) {

        const ancho = Math.max(filaOrixe.scrollWidth, filaTrad.scrollWidth);
        const hueco = caixa.clientWidth - 6;

        if (ancho <= hueco || tam <= 11) break;

        tam = Math.max(11, tam * hueco / ancho * 0.98);
        lienzo.style.setProperty("--tam-mesa", tam + "px");

    }

}

function chipOrixe(i) { return filaOrixe.querySelector('[data-i="' + i + '"]'); }

function chipTrad(t) {

    const k = tokensTrad.findIndex(function(tk) { return tk.i === t.i && tk.f === t.f; });

    return k >= 0 ? filaTrad.querySelector('[data-t="' + k + '"]') : null;

}

function conexionsValidas() {

    const trad = textoActual.traduccion || "";

    return (textoActual.conexions || []).filter(function(c) {
        return Array.isArray(c.o) && Array.isArray(c.t) &&
            c.t.every(function(t) { return trad.slice(t.i, t.f) === t.x; });
    });

}

function pintarConexions() {

    if (!modoConectar || !textoActual) return;

    [filaOrixe, filaTrad].forEach(function(fila) {
        fila.querySelectorAll(".chip-conex").forEach(function(c) {
            c.classList.remove("conectada");
            c.style.removeProperty("--cx");
            c.setAttribute("aria-pressed", "false");
        });
    });

    conexionsValidas().forEach(function(c, k) {

        const cor = CORES_CONEXION[k % CORES_CONEXION.length];

        c.o.forEach(function(o) {
            const chip = chipOrixe(o.i);
            if (chip && chip.textContent === o.x) { chip.classList.add("conectada"); chip.style.setProperty("--cx", cor); }
        });

        c.t.forEach(function(t) {
            const chip = chipTrad(t);
            if (chip) { chip.classList.add("conectada"); chip.style.setProperty("--cx", cor); }
        });

    });

    selOrixe.forEach(function(i) { const c = chipOrixe(i); if (c) c.setAttribute("aria-pressed", "true"); });
    selTrad.forEach(function(k) {
        const c = filaTrad.querySelector('[data-t="' + k + '"]');
        if (c) c.setAttribute("aria-pressed", "true");
    });

    pintarListaConexions();
    dibujarLineasConexion();

}

// Cada conexión: pes pola palabra ata o seu "carril" horizontal, e unha curva suave entre o carril do
// orixinal e o da tradución. Os carriles son distintos para cada conexión, polo que non se superpoñen.
function dibujarLineasConexion() {

    const svg = document.getElementById("lineasConexion");
    const lienzo = document.getElementById("lienzoConex");
    const NS = "http://www.w3.org/2000/svg";

    svg.replaceChildren();

    if (!modoConectar || !textoActual) return;

    const conexions = conexionsValidas();
    const n = conexions.length;

    document.getElementById("pasilloConex").style.height = (44 + n * 24) + "px";

    const base = lienzo.getBoundingClientRect();
    const rO = filaOrixe.getBoundingClientRect();
    const rT = filaTrad.getBoundingClientRect();
    const gTop = rO.bottom - base.top;
    const gBot = rT.top - base.top;

    svg.setAttribute("width", Math.ceil(lienzo.scrollWidth));
    svg.setAttribute("height", Math.ceil(lienzo.scrollHeight));

    // Cantas conexións toca cada palabra: repártense os puntos de saída ao longo dela
    const usos = new Map();
    const dados = new Map();

    conexions.forEach(function(c) {
        c.o.map(function(o) { return chipOrixe(o.i); }).concat(c.t.map(chipTrad)).filter(Boolean).forEach(function(el) {
            usos.set(el, (usos.get(el) || 0) + 1);
        });
    });

    function ancora(el) {
        const r = el.getBoundingClientRect();
        const slot = dados.get(el) || 0;

        dados.set(el, slot + 1);

        return { x: r.left - base.left + r.width * (slot + 1) / (usos.get(el) + 1), el: el };
    }

    const datos = conexions.map(function(c, k) {

        const o = c.o.map(function(x) { return chipOrixe(x.i); }).filter(Boolean).map(ancora);
        const t = c.t.map(chipTrad).filter(Boolean).map(ancora);

        return { k: k, o: o, t: t };

    }).filter(function(d) { return d.o.length && d.t.length; });

    function centroX(lista) { return lista.reduce(function(a, p) { return a + p.x; }, 0) / lista.length; }

    // Carril de cada conexión segundo a súa posición horizontal (esquerda → máis preto da fila)
    const ordeO = datos.slice().sort(function(a, b) { return centroX(a.o) - centroX(b.o); });
    const ordeT = datos.slice().sort(function(a, b) { return centroX(a.t) - centroX(b.t); });

    datos.forEach(function(d) {

        d.yO = gTop + 14 + ordeO.indexOf(d) * 12;
        d.yT = gBot - 14 - ordeT.indexOf(d) * 12;

    });

    function trazo(d, atributos) {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", d);
        p.setAttribute("fill", "none");
        Object.keys(atributos).forEach(function(k) { p.setAttribute(k, atributos[k]); });
        return p;
    }

    datos.forEach(function(d) {

        const cor = CORES_CONEXION[d.k % CORES_CONEXION.length];
        const g = document.createElementNS(NS, "g");
        const xo = centroX(d.o);
        const xt = centroX(d.t);
        // cada curva ten a súa propia altura de curvatura, para que non vaian pegadas unha a outra
        const desvio = (datos.indexOf(d) - (datos.length - 1) / 2) * 6;
        const ym1 = d.yO + (d.yT - d.yO) * 0.5 + desvio;
        const ym2 = d.yO + (d.yT - d.yO) * 0.5 - desvio;
        const curva = "M" + xo + " " + d.yO + " C" + xo + " " + ym1 + " " + xt + " " + ym2 + " " + xt + " " + d.yT;

        // halo do fondo para que os cruces se vexan limpos
        g.appendChild(trazo(curva, { stroke: "var(--superficie-2)", "stroke-width": 7, "stroke-linecap": "round" }));

        const estilo = { stroke: cor, "stroke-width": 2.5, "stroke-linecap": "round", "stroke-linejoin": "round" };

        g.appendChild(trazo(curva, estilo));

        [[d.o, d.yO, "b"], [d.t, d.yT, "t"]].forEach(function(lado) {

            const lista = lado[0];
            const y = lado[1];
            const xs = lista.map(function(p) { return p.x; });

            g.appendChild(trazo("M" + Math.min.apply(null, xs) + " " + y + " H" + Math.max.apply(null, xs), estilo));

            lista.forEach(function(p) {
                const r = p.el.getBoundingClientRect();
                const yPalabra = lado[2] === "b" ? r.bottom - base.top : r.top - base.top;
                g.appendChild(trazo("M" + p.x + " " + yPalabra + " V" + y, estilo));
            });

            const punto = document.createElementNS(NS, "circle");
            punto.setAttribute("cx", lado[2] === "b" ? xo : xt);
            punto.setAttribute("cy", y);
            punto.setAttribute("r", 4);
            punto.setAttribute("fill", cor);
            g.appendChild(punto);

        });

        svg.appendChild(g);

    });

}

function pintarListaConexions() {

    const lista = document.getElementById("listaConexions");

    lista.replaceChildren();

    conexionsValidas().forEach(function(c, k) {

        const li = crearElemento("li", "conexion-item");

        li.style.setProperty("--cx", CORES_CONEXION[k % CORES_CONEXION.length]);
        li.appendChild(crearElemento("span", "conexion-texto",
            c.o.map(function(o) { return o.x; }).join(" ") + "  ⟷  " + c.t.map(function(t) { return t.x; }).join(" ")));

        const quitar = crearBoton("Eliminar", "boton-secundario boton-pequeno", function() {
            textoActual.conexions = textoActual.conexions.filter(function(x) { return x !== c; });
            textoActual.fechaModificacion = new Date().toISOString();
            guardarBiblioteca();
            pintarConexions();
        });

        quitar.setAttribute("aria-label", "Eliminar a conexión: " + c.o.map(function(o) { return o.x; }).join(" "));
        li.appendChild(quitar);
        lista.appendChild(li);

    });

}

function actualizarBarraConectar() {

    const ordeOrixe = Array.from(selOrixe).sort(function(a, b) { return a - b; });
    const ordeTrad = Array.from(selTrad).sort(function(a, b) { return a - b; });

    document.getElementById("axudaConectar").textContent =
        ordeOrixe.length + " palabra(s) do orixinal e " + ordeTrad.length + " da tradución escollidas. " +
        (ordeOrixe.length && ordeTrad.length ? "Preme «Unir»." : "Escolle polo menos unha de cada lado.");

    if (!conexEditada) {

        const formas = ordeOrixe.map(function(i) { const c = chipOrixe(i); return c ? c.textContent : ""; });
        const a = analisisActual && ordeOrixe.length === 1 ? analisisActual[ordeOrixe[0]] : null;

        document.getElementById("conexLema").value = a && a.lema ? a.lema : formas.join(" ").toLowerCase();
        document.getElementById("conexSig").value = ordeTrad.map(function(k) { return tokensTrad[k].x; }).join(" ");

    }

    pintarConexions();

}

function limparSeleccionConexion() {

    selOrixe.clear();
    selTrad.clear();
    conexEditada = false;
    actualizarBarraConectar();

}

function unirConexion() {

    if (!modoConectar || selOrixe.size === 0 || selTrad.size === 0) {
        avisar("Escolle polo menos unha palabra do orixinal e outra da tradución.");
        return;
    }

    const o = Array.from(selOrixe).sort(function(a, b) { return a - b; }).map(function(i) {
        return { i: i, x: chipOrixe(i).textContent };
    });
    const t = Array.from(selTrad).sort(function(a, b) { return a - b; }).map(function(k) { return tokensTrad[k]; });

    if (!Array.isArray(textoActual.conexions)) textoActual.conexions = [];

    textoActual.conexions.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), o: o, t: t });
    textoActual.fechaModificacion = new Date().toISOString();

    let mensaxe = "Conexión gardada.";

    if (document.getElementById("conexVocab").checked) {

        const lema = document.getElementById("conexLema").value.trim();
        const sig = document.getElementById("conexSig").value.trim();

        if (lema && engadirVocabManual(textoActual.idioma, lema, sig, {
            forma: o.map(function(x) { return x.x; }).join(" "),
            obra: textoActual.autor + " · " + textoActual.obra,
            ref: textoActual.referencia || ""
        })) {
            mensaxe = "Conexión gardada e «" + lema + "» engadido ao vocabulario.";
        }

    }

    guardarBiblioteca();
    selOrixe.clear();
    selTrad.clear();
    conexEditada = false;
    actualizarBarraConectar();
    avisar(mensaxe);

}

function alternarEscolla(conxunto, valor) {

    if (conxunto.has(valor)) conxunto.delete(valor);
    else conxunto.add(valor);

    actualizarBarraConectar();

}

filaOrixe.addEventListener("click", function(evento) {

    const chip = evento.target.closest(".chip-conex");

    if (chip) alternarEscolla(selOrixe, Number(chip.dataset.i));

});

filaTrad.addEventListener("click", function(evento) {

    const chip = evento.target.closest(".chip-conex");

    if (chip) alternarEscolla(selTrad, Number(chip.dataset.t));

});

["conexLema", "conexSig"].forEach(function(id) {
    document.getElementById(id).addEventListener("input", function() { conexEditada = true; });
});

// Reposicionar as liñas ao cambiar o tamaño da xanela ou das letras
(function() {
    const lienzo = document.getElementById("lienzoConex");
    let pendente = false;
    function repintar() {
        if (!modoConectar || pendente) return;
        pendente = true;
        requestAnimationFrame(function() { pendente = false; dibujarLineasConexion(); });
    }
    window.addEventListener("resize", function() { if (modoConectar) { ajustarMesa(); repintar(); } });
    if (window.ResizeObserver) new ResizeObserver(repintar).observe(filaOrixe);
    if (window.ResizeObserver) new ResizeObserver(repintar).observe(filaTrad);
})();


// INICIAR LA APLICACIÓN

iniciarAxustes();
actualizarBotonTema();
cambiarTamanoTexto(0);
aplicarModoEstudo();
mostrarBiblioteca();
sincronizar(false);
recordarCopia();
