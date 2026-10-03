/* Escena: origen a la izquierda, destino a la derecha, trayectoria punteada y
   una regla a escala debajo (distancia arriba, tiempo-luz abajo).

   El viewBox mide lo mismo que el contenedor (1 unidad = 1 px), así el texto del
   SVG nunca encoge en móvil; al cambiar el tamaño se redibuja la geometría.

   La escena no lleva reloj: recibe el progreso ya calculado y solo escribe
   `transform` en el pulso y clases de opacidad en los puntos del trayecto.
   Con prefers-reduced-motion el pulso no aparece: los puntos se van
   encendiendo con un fundido, como una barra de progreso.                    */
(function () {
  "use strict";

  var App = (window.LightDelay = window.LightDelay || {});
  var SVG_NS = "http://www.w3.org/2000/svg";

  // Radio dibujado de cada cuerpo dentro de su <symbol> (no están a escala entre sí).
  var RADIUS = { earth: 24, moon: 14, mars: 18, jupiter: 34, pluto: 17, voyager: 27 };
  var DOT_GAP = 11;
  var EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
  var EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
  var EASE_SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

  function node(name, attrs, parent) {
    var el = document.createElementNS(SVG_NS, name);
    for (var key in attrs) el.setAttribute(key, attrs[key]);
    if (parent) parent.appendChild(el);
    return el;
  }

  function reduced() {
    return window.Pluton && window.Pluton.reducedMotion();
  }

  App.createScene = function (options) {
    var svg = options.svg;
    var root = options.root;
    var model = App.model;

    var route = null;
    var view = { p: 0, phase: "idle", legs: 1 }; // p: 0–1 ida, 1–2 vuelta
    var geo = null;
    var size = "";
    var dots = [];
    var litOut = 0; // puntos encendidos por la ida, desde el origen
    var litEcho = 0; // puntos encendidos por el eco, desde el destino
    var pulseOn = false;
    var els = {};

    /* ---------- construcción ---------- */

    function body(id, x, roleText) {
      var k = geo.k;
      var r = RADIUS[id] * k;
      var g = node("g", {}, root);
      var out = { r: r };
      out.ring = node("circle", { class: "ring", cx: x, cy: geo.cy, r: r + 7 }, g);
      out.use = node("use", { class: "body", href: "#b-" + id, x: x - 40 * k, y: geo.cy - 40 * k, width: 80 * k, height: 80 * k }, g);
      out.role = node("text", { class: "body-role", x: x, y: geo.cy - r - 30 }, g);
      out.role.textContent = roleText;
      out.name = node("text", { class: "body-name", x: x, y: geo.cy - r - 11 }, g);
      out.name.textContent = model.nameOf(id);
      out.g = g;
      return out;
    }

    // Tantas marcas como quepan sin que sus etiquetas se toquen.
    function fit(make, total) {
      var air = geo.k < 1 ? 14 : 44;
      for (var n = Math.floor(geo.L / 40); n > 1; n--) {
        var ticks = make(total, n);
        var chars = 0;
        for (var i = 0; i < ticks.length; i++) chars = Math.max(chars, ticks[i].label.length);
        if (ticks.length && geo.L * ticks[0].f >= chars * 6.7 + air) return ticks;
      }
      return make(total, 1);
    }

    function ruler() {
      var g = node("g", { class: "ruler" }, root);
      var x0 = geo.x0;
      var ry = geo.ry;

      node("line", { class: "ruler-line", x1: x0, y1: ry, x2: geo.x1, y2: ry }, g);
      node("line", { class: "ruler-line", x1: x0, y1: ry - 7, x2: x0, y2: ry + 7 }, g);
      node("line", { class: "ruler-line", x1: geo.x1, y1: ry - 7, x2: geo.x1, y2: ry + 7 }, g);

      fit(model.distanceTicks, route.km).forEach(function (tick) {
        var x = (x0 + geo.L * tick.f).toFixed(1);
        node("line", { class: "ruler-line", x1: x, y1: ry - 6, x2: x, y2: ry }, g);
        node("text", { class: "tick-label", x: x, y: ry - 12 }, g).textContent = tick.label;
      });
      fit(model.timeTicks, route.seconds).forEach(function (tick) {
        var x = (x0 + geo.L * tick.f).toFixed(1);
        node("line", { class: "ruler-line ruler-line--time", x1: x, y1: ry, x2: x, y2: ry + 6 }, g);
        node("text", { class: "tick-label tick-label--time", x: x, y: ry + 21 }, g).textContent = tick.label;
      });
    }

    function build() {
      var W = Math.round(svg.clientWidth);
      var H = Math.round(svg.clientHeight);
      if (!route || !W || !H) return;
      size = W + "x" + H;

      var compact = W < 560;
      var pad = compact ? 48 : Math.round(Math.min(96, Math.max(64, W * 0.08)));
      geo = { k: compact ? 0.8 : 1, x0: pad, x1: W - pad, L: W - pad * 2, cy: compact ? 74 : 88, ry: H - (compact ? 34 : 38) };

      svg.setAttribute("viewBox", "0 0 " + W + " " + H);
      root.textContent = "";
      dots = [];
      litOut = 0;
      litEcho = 0;
      pulseOn = false;

      var r0 = RADIUS[route.from] * geo.k;
      var r1 = RADIUS[route.to] * geo.k;

      // Guías: unen cada cuerpo con su extremo de la regla.
      node("line", { class: "guide", x1: geo.x0, y1: geo.cy + r0 + 8, x2: geo.x0, y2: geo.ry - 9 }, root);
      node("line", { class: "guide", x1: geo.x1, y1: geo.cy + r1 + 8, x2: geo.x1, y2: geo.ry - 9 }, root);
      ruler();

      var track = node("g", {}, root);
      var count = Math.max(2, Math.round(geo.L / DOT_GAP));
      for (var i = 1; i < count; i++) {
        var x = geo.x0 + (geo.L * i) / count;
        if (x < geo.x0 + r0 + 7 || x > geo.x1 - r1 - 7) continue;
        dots.push({ f: i / count, el: node("circle", { class: "dot", cx: x.toFixed(1), cy: geo.cy, r: 1.4 }, track) });
      }

      // Pulso: frente de onda con una estela corta y un cursor que baja hasta la regla.
      els.pulse = node("g", { class: "pulse" }, root);
      node("line", { class: "pulse-cursor", x1: 0, y1: 10, x2: 0, y2: geo.ry - geo.cy }, els.pulse);
      node("circle", { class: "pulse-glow", r: 14 }, els.pulse);
      node("path", { class: "pulse-arc", d: "M-7 -9 A12 12 0 0 1 -7 9", opacity: 0.9 }, els.pulse);
      node("path", { class: "pulse-arc", d: "M-15 -7.5 A10 10 0 0 1 -15 7.5", opacity: 0.55 }, els.pulse);
      node("path", { class: "pulse-arc", d: "M-23 -6 A8 8 0 0 1 -23 6", opacity: 0.28 }, els.pulse);
      node("circle", { class: "pulse-head", r: 3.5 }, els.pulse);

      els.from = body(route.from, geo.x0, "origen");
      els.to = body(route.to, geo.x1, "destino");
    }

    /* ---------- estado ---------- */

    function setRole(side, text, ok) {
      if (side.role.textContent !== text) side.role.textContent = text;
      side.role.classList.toggle("is-ok", ok);
    }

    function draw() {
      if (!geo) return;
      var p = view.p;
      var back = p > 1;
      var echoFrom = back ? 2 - p : Infinity;
      var n = dots.length;

      // Solo se tocan los puntos que cambian desde el frame anterior.
      while (litOut < n && dots[litOut].f <= p) dots[litOut++].el.classList.add("is-lit");
      while (litOut > 0 && dots[litOut - 1].f > p) dots[--litOut].el.classList.remove("is-lit");
      while (litEcho < n && dots[n - 1 - litEcho].f >= echoFrom) dots[n - 1 - litEcho++].el.classList.add("is-echo");
      while (litEcho > 0 && dots[n - litEcho].f < echoFrom) dots[n - litEcho--].el.classList.remove("is-echo");

      var flying = view.phase === "outbound" || view.phase === "return";
      var show = flying && !reduced();
      if (show !== pulseOn) {
        pulseOn = show;
        els.pulse.classList.toggle("is-on", show);
      }
      els.pulse.classList.toggle("is-echo", back);
      if (show) {
        var x = geo.x0 + geo.L * (back ? 2 - p : p);
        els.pulse.setAttribute("transform", "translate(" + x.toFixed(2) + " " + geo.cy + ")" + (back ? " scale(-1 1)" : ""));
      }

      var delivered = view.phase === "return" || view.phase === "done";
      var echoed = view.phase === "done" && view.legs === 2;
      setRole(els.from, view.phase === "outbound" ? "transmitiendo" : view.phase === "return" ? "esperando eco" : echoed ? "eco recibido" : "origen", echoed);
      setRole(els.to, delivered ? "recibido" : "destino", delivered);
    }

    // Un anillo que se abre desde el cuerpo: al emitir y al recibir.
    function emit(sideName, receiving) {
      var side = els[sideName];
      if (!side || !side.ring.animate) return;
      side.ring.classList.toggle("is-echo", Boolean(receiving));

      if (reduced()) {
        side.ring.animate([{ opacity: 0 }, { opacity: 0.7 }, { opacity: 0 }], { duration: 700, easing: EASE_IN_OUT });
        return;
      }
      side.ring.animate(
        [
          { transform: "scale(1)", opacity: 0.8 },
          { transform: "scale(1.8)", opacity: 0 },
        ],
        { duration: 900, easing: EASE_OUT }
      );
      if (receiving) {
        side.use.animate([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], { duration: 520, easing: EASE_SPRING });
      }
    }

    function enter(side, fromX) {
      if (!side.g.animate) return;
      if (reduced() || fromX === null) {
        side.g.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: EASE_OUT });
      } else {
        // Intercambio: cada cuerpo viaja desde el extremo contrario.
        side.g.animate([{ transform: "translateX(" + fromX + "px)" }, { transform: "translateX(0)" }], { duration: 620, easing: EASE_IN_OUT });
      }
    }

    function setRoute(next) {
      var previous = route;
      route = next;
      build();
      draw();
      if (!previous || !geo) return;

      if (previous.from === next.to && previous.to === next.from) {
        enter(els.from, geo.L);
        enter(els.to, -geo.L);
      } else {
        if (previous.from !== next.from) enter(els.from, null);
        if (previous.to !== next.to) enter(els.to, null);
      }
    }

    function resize() {
      if (Math.round(svg.clientWidth) + "x" + Math.round(svg.clientHeight) === size) return;
      build();
      draw();
    }

    if (window.ResizeObserver) new ResizeObserver(resize).observe(svg);
    else window.addEventListener("resize", resize);

    return {
      setRoute: setRoute,
      emit: emit,
      update: function (next) {
        view = next;
        draw();
      },
    };
  };
})();
