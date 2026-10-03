/* Modelo: distancias, tiempo de luz y formato de cifras. No toca el DOM.

   Qué significa "distancia" aquí (los planetas se mueven, así que hay que elegir):
   · Tierra–Luna: semieje mayor de la órbita lunar; rango de perigeo a apogeo.
   · Dos cuerpos que orbitan el Sol: punto medio entre el máximo acercamiento
     (perihelio del exterior − afelio del interior) y la máxima separación
     (afelio + afelio). Ese punto medio es el semieje mayor del cuerpo exterior.
   · La Luna cuenta como la Tierra: 384 400 km no se notan a escala planetaria.
   · Voyager 1 no orbita, se aleja: su distancia depende de la fecha.          */
(function () {
  "use strict";

  var App = (window.LightDelay = window.LightDelay || {});

  var C = 299792.458; // km/s, exacta por definición
  var AU = 149597870.7; // km, exacta por definición (UAI 2012)
  var DAY_MS = 86400000;
  var RAD = Math.PI / 180;
  var NBSP = " ";

  var BODIES = [
    { id: "earth", name: "Tierra" },
    { id: "moon", name: "Luna" },
    { id: "mars", name: "Marte" },
    { id: "jupiter", name: "Júpiter" },
    { id: "pluto", name: "Plutón" },
    { id: "voyager", name: "Voyager 1" },
  ];

  // Perihelio (q) y afelio (Q) en UA.
  var ORBITS = {
    earth: { q: 0.9833, Q: 1.0167 },
    mars: { q: 1.3814, Q: 1.666 },
    jupiter: { q: 4.9506, Q: 5.457 },
    pluto: { q: 29.658, Q: 49.305 },
  };

  var MOON = { mean: 384400, min: 356500, max: 406700 }; // km

  // Voyager 1: distancia al Sol en la época, ritmo de alejamiento y dirección
  // eclíptica aproximada. Calibrado para que cruce un día-luz de la Tierra a
  // mediados de noviembre de 2026.
  var VOYAGER = { epoch: Date.UTC(2025, 6, 1), au: 167.5, rate: 3.57, lon: 257, lat: 35 };

  var MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

  function nameOf(id) {
    for (var i = 0; i < BODIES.length; i++) if (BODIES[i].id === id) return BODIES[i].name;
    return "";
  }

  function isBody(id) {
    return nameOf(id) !== "";
  }

  function semiMajor(id) {
    return (ORBITS[id].q + ORBITS[id].Q) / 2;
  }

  function voyagerSun(date) {
    return VOYAGER.au + (VOYAGER.rate * (date - VOYAGER.epoch)) / (365.25 * DAY_MS);
  }

  // Longitud heliocéntrica media de la Tierra en grados. Ignora la excentricidad:
  // el error (< 2°) mueve la distancia a Voyager 1 menos de 0,03 UA.
  function earthLongitude(date) {
    var days = (date - Date.UTC(2000, 0, 1, 12)) / DAY_MS;
    return (((100.464 + 0.98564736 * days) % 360) + 360) % 360;
  }

  function voyagerEarth(date) {
    var r = voyagerSun(date);
    var cos = Math.cos(VOYAGER.lat * RAD) * Math.cos((VOYAGER.lon - earthLongitude(date)) * RAD);
    return Math.sqrt(r * r + 1 - 2 * r * cos);
  }

  /* ---------- formato ---------- */

  // Coma decimal y espacio de millares a partir de cinco cifras (norma española).
  function formatNumber(value, decimals) {
    var parts = Math.abs(value).toFixed(decimals).split(".");
    var int = parts[0];
    if (int.length > 4) int = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return int + (parts[1] ? "," + parts[1] : "");
  }

  function formatDuration(seconds) {
    if (seconds < 59.9995) return formatNumber(seconds, 3) + NBSP + "s";
    var total = Math.max(60, Math.floor(seconds + 1e-6));
    var d = Math.floor(total / 86400);
    var h = Math.floor((total % 86400) / 3600);
    var m = Math.floor((total % 3600) / 60);
    var out = [];
    if (d) out.push(d + NBSP + "d");
    if (d || h) out.push(h + NBSP + "h");
    out.push(m + NBSP + "min");
    out.push((total % 60) + NBSP + "s");
    return out.join(" ");
  }

  // Versión corta para rangos y totales largos: desde una hora, sin segundos.
  function formatSpan(seconds) {
    if (seconds < 3600) return formatDuration(seconds);
    return formatDuration(Math.floor(seconds / 60) * 60).replace(/ 0 s$/, "");
  }

  // "M km" = millones de km.
  function formatKm(km) {
    if (km < 1e7) return formatNumber(km, 0) + NBSP + "km";
    var millions = km / 1e6;
    return formatNumber(millions, millions < 100 ? 2 : millions < 1000 ? 1 : 0) + NBSP + "M" + NBSP + "km";
  }

  function formatAU(au) {
    return formatNumber(au, au < 0.01 ? 5 : au < 10 ? 3 : au < 100 ? 2 : 1) + NBSP + "UA";
  }

  function formatDate(date) {
    var d = new Date(+date);
    return d.getUTCDate() + " de " + MONTHS[d.getUTCMonth()] + " de " + d.getUTCFullYear();
  }

  /* ---------- ruta ---------- */

  function make(from, to, km, minKm, maxKm, label, note) {
    return {
      from: from,
      to: to,
      fromName: nameOf(from),
      toName: nameOf(to),
      km: km,
      au: km / AU,
      seconds: km / C,
      minSeconds: minKm / C,
      maxSeconds: maxKm / C,
      label: label,
      note: note,
    };
  }

  function route(from, to, when) {
    var date = +when;
    var pairName = nameOf(from) + "–" + nameOf(to);

    if ((from === "earth" && to === "moon") || (from === "moon" && to === "earth")) {
      return make(
        from,
        to,
        MOON.mean,
        MOON.min,
        MOON.max,
        "distancia media",
        pairName + ": semieje mayor de la órbita lunar. El rango va del perigeo al apogeo."
      );
    }

    // A escala planetaria la Luna está donde la Tierra.
    var a = from === "moon" ? "earth" : from;
    var b = to === "moon" ? "earth" : to;
    var viaMoon = a !== from || b !== to;
    var moonNote = viaMoon ? " Desde la Luna vale lo mismo que desde la Tierra: sus 384 400 km (1,3 s-luz) no se notan a esta escala." : "";

    if (a !== "voyager" && b !== "voyager") {
      var inner = semiMajor(a) < semiMajor(b) ? a : b;
      var outer = inner === a ? b : a;
      var mean = semiMajor(outer);
      return make(
        from,
        to,
        mean * AU,
        (ORBITS[outer].q - ORBITS[inner].Q) * AU,
        (ORBITS[outer].Q + ORBITS[inner].Q) * AU,
        "distancia media",
        pairName +
          ": la media es el punto medio entre el máximo acercamiento y la máxima separación, que coincide con el radio orbital medio de " +
          nameOf(outer) +
          " (" +
          formatAU(mean) +
          "). El rango usa perihelios y afelios." +
          moonNote
      );
    }

    var other = a === "voyager" ? b : a;
    var r = voyagerSun(date);
    var cosLat = Math.cos(VOYAGER.lat * RAD);

    if (other === "earth") {
      return make(
        from,
        to,
        voyagerEarth(date) * AU,
        (r - cosLat) * AU,
        (r + cosLat) * AU,
        "distancia hoy",
        pairName +
          ": Voyager 1 no orbita, se aleja. Modelo: 167,5 UA del Sol a mediados de 2025 más 3,57 UA por año, con la posición de la Tierra en su órbita el " +
          formatDate(date) +
          ". El rango es el vaivén anual que añade la órbita terrestre." +
          moonNote
      );
    }

    var far = ORBITS[other].Q;
    var cross = 2 * r * far * cosLat;
    return make(
      from,
      to,
      r * AU,
      Math.sqrt(r * r + far * far - cross) * AU,
      Math.sqrt(r * r + far * far + cross) * AU,
      "distancia media",
      pairName +
        ": se toma la distancia Sol–Voyager 1 del " +
        formatDate(date) +
        " (" +
        formatAU(r) +
        "); la posición de " +
        nameOf(other) +
        " en su órbita la mueve dentro del rango."
    );
  }

  /* ---------- marcas de la regla ---------- */

  function decimalsOf(step) {
    for (var d = 0; d < 6; d++) {
      var scaled = step * Math.pow(10, d);
      if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return d;
    }
    return 6;
  }

  function buildTicks(total, step, unit) {
    var ticks = [];
    var decimals = decimalsOf(step);
    for (var i = 1; i * step < total * 0.985; i++) {
      ticks.push({ f: (i * step) / total, label: formatNumber(i * step, decimals) + NBSP + unit });
    }
    return ticks;
  }

  // Paso "redondo" (1, 2, 2,5 o 5 por una potencia de diez) que no pasa de maxTicks marcas.
  function distanceTicks(km, maxTicks) {
    var inAU = km >= 0.1 * AU;
    var total = inAU ? km / AU : km;
    var raw = total / Math.max(1, maxTicks);
    var pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var n = raw / pow;
    var step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * pow;
    return buildTicks(total, step, inAU ? "UA" : "km");
  }

  var TIME_UNITS = [
    { limit: 120, size: 1, unit: "s", steps: [0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 20, 30, 60] },
    { limit: 7200, size: 60, unit: "min", steps: [1, 2, 5, 10, 15, 20, 30, 60] },
    { limit: 172800, size: 3600, unit: "h", steps: [1, 2, 3, 4, 6, 12, 24] },
    { limit: Infinity, size: 86400, unit: "d", steps: [1, 2, 5, 10, 20, 50, 100] },
  ];

  // Marcas de tiempo-luz en la unidad natural del trayecto: segundos, minutos, horas o días.
  function timeTicks(seconds, maxTicks) {
    var tier = TIME_UNITS[0];
    for (var i = 0; i < TIME_UNITS.length; i++) {
      tier = TIME_UNITS[i];
      if (seconds < tier.limit) break;
    }
    var total = seconds / tier.size;
    var step = tier.steps[tier.steps.length - 1];
    for (var k = 0; k < tier.steps.length; k++) {
      if (total / tier.steps[k] <= Math.max(1, maxTicks)) {
        step = tier.steps[k];
        break;
      }
    }
    return buildTicks(total, step, tier.unit);
  }

  App.model = {
    C: C,
    bodies: BODIES,
    isBody: isBody,
    nameOf: nameOf,
    route: route,
    distanceTicks: distanceTicks,
    timeTicks: timeTicks,
    format: {
      number: formatNumber,
      duration: formatDuration,
      span: formatSpan,
      km: formatKm,
      au: formatAU,
    },
  };
})();
