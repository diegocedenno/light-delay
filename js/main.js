/* Control: ruta, reloj de la señal, contadores y persistencia.

   La posición de la señal sale siempre de marcas de tiempo, nunca de contar frames:
     tiempo de señal = acumulado + (ahora − desde) × aceleración
   Por eso un viaje de horas a ×1 sobrevive a una pestaña en segundo plano: al
   volver, la señal está donde debe. Cambiar la aceleración en pleno vuelo solo
   guarda lo acumulado y vuelve a contar desde ese instante.                    */
(function () {
  "use strict";

  var App = window.LightDelay;
  var model = App.model;
  var fmt = model.format;
  var STORE_KEY = "light-delay:v1";
  var ACCELS = [1, 10, 100, 1000];
  var REDUCED_TICK_MS = 100; // con movimiento reducido no hay bucle de frames

  var els = {
    stage: document.getElementById("stage"),
    svg: document.getElementById("scene"),
    status: document.getElementById("status"),
    distLabel: document.getElementById("dist-label"),
    distValue: document.getElementById("dist-value"),
    timeValue: document.getElementById("time-value"),
    rangeValue: document.getElementById("range-value"),
    receipt: document.getElementById("receipt"),
    note: document.getElementById("note"),
    telemetry: document.getElementById("telemetry"),
    signal: document.getElementById("t-signal"),
    signalSub: document.getElementById("t-signal-sub"),
    dist: document.getElementById("t-dist"),
    distSub: document.getElementById("t-dist-sub"),
    pct: document.getElementById("t-pct"),
    pctSub: document.getElementById("t-pct-sub"),
    eta: document.getElementById("t-eta"),
    etaSub: document.getElementById("t-eta-sub"),
    form: document.getElementById("controls"),
    from: document.getElementById("from"),
    to: document.getElementById("to"),
    swap: document.getElementById("swap"),
    msg: document.getElementById("msg"),
    echo: document.getElementById("echo"),
    sendLabel: document.getElementById("send-label"),
    hintText: document.getElementById("hint-text"),
    boost: document.getElementById("boost"),
  };

  var scene = App.createScene({ svg: els.svg, root: document.getElementById("scene-root") });

  var state = { from: "earth", to: "moon", accel: 1, echo: false };
  var route = null;
  var trip = null; // envío en curso o ya entregado
  var phase = "idle"; // idle → outbound → (return) → done
  var frame = 0;
  var timer = 0;

  /* ---------- persistencia ---------- */

  function load() {
    try {
      var data = JSON.parse(window.localStorage.getItem(STORE_KEY));
      if (!data) return;
      if (model.isBody(data.from) && model.isBody(data.to) && data.from !== data.to) {
        state.from = data.from;
        state.to = data.to;
      }
      if (ACCELS.indexOf(data.accel) !== -1) state.accel = data.accel;
      if (typeof data.echo === "boolean") state.echo = data.echo;
    } catch (err) {
      /* sin almacenamiento o con datos rotos: se queda la ruta por defecto */
    }
  }

  function save() {
    try {
      window.localStorage.setItem(STORE_KEY, JSON.stringify(state));
    } catch (err) {
      /* almacenamiento no disponible: todo sigue funcionando */
    }
  }

  /* ---------- reloj ---------- */

  // performance.now() da pasos suaves por debajo del milisegundo, pero puede
  // detenerse si el equipo se suspende; si se separa del reloj de pared, se reancla.
  var anchor = { wall: Date.now(), perf: performance.now() };

  function now() {
    if (Math.abs(Date.now() - anchor.wall - (performance.now() - anchor.perf)) > 250) {
      anchor = { wall: Date.now(), perf: performance.now() };
    }
    return anchor.wall + (performance.now() - anchor.perf);
  }

  function signalTime() {
    return trip.bank + ((now() - trip.since) / 1000) * trip.accel;
  }

  function flying() {
    return phase === "outbound" || phase === "return";
  }

  /* ---------- vista ---------- */

  function setText(el, text) {
    if (el.textContent !== text) el.textContent = text;
  }

  function setStatus(text) {
    els.status.innerHTML = "";
    els.status.append("status: ");
    var strong = document.createElement("b");
    strong.textContent = text;
    els.status.appendChild(strong);
  }

  // Acuse: trozos de texto; los que van entre corchetes se resaltan.
  function setReceipt(parts, ok) {
    els.receipt.innerHTML = "";
    parts.forEach(function (part) {
      if (Array.isArray(part)) {
        var strong = document.createElement("b");
        strong.textContent = part[0];
        els.receipt.appendChild(strong);
      } else {
        els.receipt.append(part);
      }
    });
    els.receipt.classList.toggle("is-ok", Boolean(ok));
  }

  function setPhase(next) {
    phase = next;
    els.stage.dataset.phase = next;
  }

  function legsNow() {
    return trip ? trip.legs : state.echo ? 2 : 1;
  }

  function render(seconds) {
    var legs = legsNow();
    var accel = flying() ? trip.accel : state.accel;
    var total = route.seconds * legs;
    var signal = fmt.duration(seconds);
    var eta = fmt.duration((total - seconds) / accel);

    setText(els.signal, signal);
    setText(els.signalSub, "de " + (total < 86400 ? fmt.duration(total) : fmt.span(total)));
    setText(els.dist, fmt.km(seconds * model.C));
    setText(els.distSub, "de " + fmt.km(route.km * legs));
    setText(els.pct, fmt.number((100 * seconds) / total, 1) + " %");
    setText(els.pctSub, phase === "outbound" ? "ida" : phase === "return" ? "vuelta" : phase === "done" ? "completado" : "en espera");
    setText(els.eta, eta);
    setText(els.etaSub, phase === "done" ? "entregado" : "tiempo real a ×" + accel);

    // Las cifras con días no caben al tamaño normal: las cuatro encogen a la vez.
    var chars = Math.max(signal.length, eta.length);
    var size = chars > 18 ? "s" : chars > 15 ? "m" : "l";
    if (els.telemetry.dataset.size !== size) els.telemetry.dataset.size = size;

    scene.update({ p: seconds / route.seconds, phase: phase, legs: legs });
  }

  // Duración real del envío con la aceleración elegida y, si es larga, una salida.
  function renderHint() {
    var total = route.seconds * (state.echo ? 2 : 1);
    var real = total / state.accel;
    var better = 0;

    if (real > 45) {
      for (var i = 0; i < ACCELS.length; i++) {
        if (ACCELS[i] > state.accel && (!better || total / better > 30)) better = ACCELS[i];
      }
    }

    els.hintText.textContent = "a ×" + state.accel + (state.echo ? " la ida y vuelta dura " : " el viaje dura ") + fmt.duration(real) + " reales" + (better ? " ·" : "");
    els.boost.hidden = !better;
    if (better) {
      els.boost.textContent = "acelerar a ×" + better + " (" + fmt.duration(total / better) + ")";
      els.boost.dataset.accel = String(better);
    }
  }

  /* ---------- bucle ---------- */

  function stopLoop() {
    if (frame) cancelAnimationFrame(frame);
    if (timer) clearTimeout(timer);
    frame = 0;
    timer = 0;
  }

  function schedule() {
    if (document.hidden) {
      // En segundo plano no se dibuja nada: basta despertar en el siguiente hito.
      var goal = trip.arrived ? route.seconds * trip.legs : route.seconds;
      var wait = ((goal - signalTime()) / trip.accel) * 1000 + 30;
      timer = window.setTimeout(tick, Math.min(Math.max(wait, 30), 2147483647));
    } else if (window.Pluton.reducedMotion()) {
      timer = window.setTimeout(tick, REDUCED_TICK_MS);
    } else {
      frame = requestAnimationFrame(tick);
    }
  }

  function tick() {
    frame = 0;
    timer = 0;
    if (!trip || !flying()) return;

    var total = route.seconds * trip.legs;
    var seconds = Math.min(total, signalTime());
    if (!trip.arrived && seconds >= route.seconds) arrive();
    if (seconds >= total) finish();
    render(seconds);
    if (flying()) schedule();
  }

  /* ---------- envío ---------- */

  function quote(text) {
    return "«" + text + "»";
  }

  function send() {
    stopLoop();
    trip = {
      legs: state.echo ? 2 : 1,
      accel: state.accel,
      bank: 0, // segundos de señal acumulados antes de `since`
      since: now(),
      arrived: false,
      message: els.msg.value.trim() || "ping",
    };
    setPhase("outbound");
    els.sendLabel.textContent = "Reenviar";
    setStatus("señal en vuelo · ×" + trip.accel);
    setReceipt(["transmitiendo ", [quote(trip.message)], " hacia " + route.toName + "…"]);
    scene.emit("from", false);
    tick();
  }

  function arrive() {
    trip.arrived = true;
    scene.emit("to", true);
    if (trip.legs === 2) {
      setPhase("return");
      setStatus("recibido en " + route.toName + " · eco de vuelta");
      setReceipt([route.toName + " recibió ", [quote(trip.message)], " tras ", [fmt.duration(route.seconds)], " · eco en camino"], true);
    }
  }

  function finish() {
    setPhase("done");
    if (trip.legs === 2) {
      scene.emit("from", true);
      setStatus("eco recibido · " + fmt.duration(route.seconds * 2));
      setReceipt(
        [route.toName + " recibió ", [quote(trip.message)], " tras ", [fmt.duration(route.seconds)], " · eco en " + route.fromName + " a los ", [fmt.duration(route.seconds * 2)]],
        true
      );
    } else {
      setStatus("recibido en " + route.toName + " · " + fmt.duration(route.seconds));
      setReceipt([route.toName + " recibió ", [quote(trip.message)], " tras ", [fmt.duration(route.seconds)], " de viaje"], true);
    }
  }

  function reset(statusText) {
    stopLoop();
    trip = null;
    setPhase("idle");
    els.sendLabel.textContent = "Enviar señal";
    setStatus(statusText || "listo · " + route.fromName + " → " + route.toName);
    setReceipt(["pulsa enviar: la señal viaja en tiempo real"]);
    render(0);
  }

  /* ---------- ruta y aceleración ---------- */

  function applyRoute() {
    route = model.route(state.from, state.to, Date.now());
    els.from.value = state.from;
    els.to.value = state.to;

    setText(els.distLabel, route.label);
    setText(els.distValue, fmt.km(route.km) + " · " + fmt.au(route.au));
    setText(els.timeValue, fmt.duration(route.seconds));
    setText(els.rangeValue, fmt.span(route.minSeconds) + " – " + fmt.span(route.maxSeconds));
    setText(els.note, route.note);
    els.svg.setAttribute(
      "aria-label",
      route.fromName + " a la izquierda y " + route.toName + " a la derecha, separados " + fmt.km(route.km) + ": " + fmt.duration(route.seconds) + " a la velocidad de la luz."
    );

    scene.setRoute(route);
    reset();
    renderHint();
  }

  // Elegir en un lado el cuerpo que ya está en el otro equivale a intercambiarlos.
  function choose(side, id) {
    var other = side === "from" ? "to" : "from";
    if (!model.isBody(id) || id === state[side]) return;
    if (id === state[other]) state[other] = state[side];
    state[side] = id;
    save();
    applyRoute();
  }

  function setAccel(value) {
    if (ACCELS.indexOf(value) === -1) return;
    if (flying()) {
      trip.bank = signalTime();
      trip.since = now();
      trip.accel = value;
      setStatus((phase === "return" ? "eco de vuelta" : "señal en vuelo") + " · ×" + value);
    }
    state.accel = value;
    document.getElementById("accel-" + value).checked = true;
    save();
    renderHint();
    if (!flying()) render(trip ? route.seconds * trip.legs : 0);
  }

  /* ---------- eventos ---------- */

  els.form.addEventListener("submit", function (event) {
    event.preventDefault();
    send();
  });

  els.from.addEventListener("change", function () {
    choose("from", els.from.value);
  });

  els.to.addEventListener("change", function () {
    choose("to", els.to.value);
  });

  els.swap.addEventListener("click", function () {
    var from = state.from;
    state.from = state.to;
    state.to = from;
    save();
    applyRoute();
  });

  els.form.addEventListener("change", function (event) {
    if (event.target.name === "accel") setAccel(Number(event.target.value));
  });

  els.boost.addEventListener("click", function () {
    setAccel(Number(els.boost.dataset.accel));
    // El botón desaparece al aplicarse: el foco pasa al radio que queda marcado.
    document.getElementById("accel-" + state.accel).focus({ preventScroll: true });
  });

  els.echo.addEventListener("change", function () {
    state.echo = els.echo.checked;
    save();
    renderHint();
    // Un envío ya entregado se guarda para no mezclar sus cifras con el nuevo trayecto.
    if (!flying()) reset();
  });

  document.addEventListener("visibilitychange", function () {
    stopLoop();
    if (flying()) tick();
  });

  if (window.matchMedia) {
    var motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.addEventListener) {
      motion.addEventListener("change", function () {
        if (trip) render(Math.min(route.seconds * trip.legs, flying() ? signalTime() : route.seconds * trip.legs));
      });
    }
  }

  /* ---------- arranque ---------- */

  load();
  els.echo.checked = state.echo;
  document.getElementById("accel-" + state.accel).checked = true;
  applyRoute();
})();
