// Baut aus resi-helper.js ein eigenständiges Tampermonkey-Skript mit Auto-Update.
//
//   node build.js <github-benutzer> <repo-name> [autor]
//
// Ergebnis: resi-helfer.user.js (im Hauptordner – genau diese Datei holt Tampermonkey für Updates)
// Für ein Update: VERSION in resi-helper.js erhöhen, neu bauen, Datei auf GitHub hochladen.
// Tampermonkey vergleicht @version und installiert neuere Versionen automatisch.
const fs = require('fs');
const path = require('path');

const [user, repo = 'resi-helfer', author] = process.argv.slice(2);
if (!user) {
  console.error('Aufruf: node build.js <github-benutzer> [repo-name] [autor]');
  process.exit(1);
}

const src = fs.readFileSync(path.join(__dirname, 'resi-helper.js'), 'utf8');
const version = src.match(/const VERSION = '([\d.]+)'/)?.[1];
if (!version) throw new Error('VERSION in resi-helper.js nicht gefunden');
new Function(src); // Syntaxprüfung vor dem Bauen

const raw = `https://raw.githubusercontent.com/${user}/${repo}/main/resi-helfer.user.js`;
const header = [
  '// ==UserScript==',
  '// @name         ReSi-Helfer',
  `// @namespace    https://github.com/${user}/${repo}`,
  `// @version      ${version}`,
  '// @description  Komfort für den Rettungssimulator: Statusleiste, Einsatz-Check, Countdown, Hotkeys, Notizen, Tagesleiste und mehr – alles einzeln abschaltbar.',
  author ? `// @author       ${author}` : null,
  '// @match        https://rettungssimulator.online/*',
  '// @icon         https://rettungssimulator.online/images/ReSi-Logo.svg',
  '// @grant        none',
  '// @run-at       document-idle',
  `// @homepageURL  https://github.com/${user}/${repo}`,
  `// @supportURL   https://github.com/${user}/${repo}/issues`,
  `// @updateURL    ${raw}`,
  `// @downloadURL  ${raw}`,
  '// ==/UserScript==',
].filter(Boolean).join('\n');

// Im Seitenkontext ausführen, damit das Skript auf die Spiel-Objekte (ControlCenter, socket …) zugreifen kann
const body = `
(function () {
  'use strict';
  const code = ${JSON.stringify(src)};
  const s = document.createElement('script');
  s.textContent = code + '\\n//# sourceURL=resi-helfer.user.js';
  (document.head || document.documentElement).appendChild(s);
  s.remove();
})();
`;

const out = path.join(__dirname, 'resi-helfer.user.js');
fs.writeFileSync(out, header + '\n' + body);
console.log(`Gebaut: resi-helfer.user.js (Version ${version})`);
console.log(`Installations-/Update-Link: ${raw}`);
