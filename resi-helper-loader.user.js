// ==UserScript==
// @name         ReSi-Helfer (Lader)
// @namespace    resi-helfer
// @version      1.0
// @description  Lädt den ReSi-Helfer bei jedem Seitenaufruf frisch vom lokalen Entwicklungsserver.
// @match        https://rettungssimulator.online/*
// @grant        GM_xmlhttpRequest
// @connect      127.0.0.1
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';
  const URL = 'http://127.0.0.1:8765/resi-helper.js?t=' + Date.now();

  GM_xmlhttpRequest({
    method: 'GET',
    url: URL,
    nocache: true,
    onload(res) {
      if (res.status !== 200) {
        console.warn('[ReSi-Helfer] Server antwortet mit', res.status);
        return;
      }
      // Im Seitenkontext ausführen, damit das Skript auf die Spiel-Objekte (z. B. socket) zugreifen kann.
      const s = document.createElement('script');
      s.textContent = res.responseText + '\n//# sourceURL=resi-helper.js';
      (document.head || document.documentElement).appendChild(s);
      s.remove();
    },
    onerror() {
      console.warn('[ReSi-Helfer] Lokaler Server nicht erreichbar (node server.js gestartet?)');
    },
  });
})();
