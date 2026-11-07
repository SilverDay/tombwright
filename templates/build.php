<?php
// The tomb builder (`/build`, M2). Static markup; the editor is public/js/build/. Served by public/index.php with the
// security headers (CSP: no inline script or style), so everything dynamic is set from the external script.
declare(strict_types=1);
?><!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Builder · Tombwright</title>
<meta name="robots" content="noindex">
<link rel="stylesheet" href="/assets/css/build.css">
<script type="module" src="/js/build/main.js"></script>
</head><body>
<header class="bar">
  <a class="brand" href="/">Tombwright</a><span class="preview">Builder · preview</span>
  <label class="title">Title <input id="title" type="text" maxlength="60" autocomplete="off"></label>
  <span class="spacer"></span>
  <button id="newBtn" type="button">New</button>
  <button id="openBtn" type="button">Open…</button>
  <button id="saveBtn" type="button">Export</button>
  <button id="undoBtn" type="button" disabled>Undo</button>
  <button id="redoBtn" type="button" disabled>Redo</button>
  <button id="playBtn" type="button" class="primary">Playtest</button>
  <input id="file" type="file" accept=".json,application/json" hidden>
</header>
<div class="work">
  <nav class="tools" aria-label="Tools">
    <h2>Cells</h2>
    <div id="cellTools" role="radiogroup" aria-label="Cell to paint"></div>
    <h2>Place</h2>
    <div id="placeTools" role="radiogroup" aria-label="Placement tools"></div>
    <label class="check"><input id="rectMode" type="checkbox"> Fill rectangles</label>
    <h2>Things</h2>
    <label class="check">Foe to place <select id="foeKind"></select></label>
    <div id="thingTools" role="radiogroup" aria-label="Things to place"></div>
    <h2>View</h2>
    <div class="row"><button id="zoomOut" type="button" aria-label="Zoom out">−</button><span id="zoomLabel"></span><button id="zoomIn" type="button" aria-label="Zoom in">+</button></div>
  </nav>
  <main class="stage" id="stage"><canvas id="grid" aria-label="Tomb plan" tabindex="0"></canvas></main>
  <aside class="side">
    <section><h2>Checks</h2><p id="status" role="status" aria-live="polite"></p><ul id="problems"></ul></section>
    <section><h2>Selected</h2><div id="inspector"></div></section>
    <section><h2>Chambers</h2><ul id="zones" class="zones"></ul><p class="hint" id="zoneHint"></p></section>
    <section><h2>This tomb</h2><p id="summary"></p><p id="threat"></p></section>
    <section class="note"><p>Saved in this browser as you work. <b>Export</b> keeps a copy as a file; <b>Open…</b> loads one. Playtest runs the tomb in practice mode.</p></section>
  </aside>
</div>
<dialog id="newDlg"><form method="dialog"><h2>New tomb</h2>
  <label>Width <input id="newW" type="number" min="6" max="64" value="16"></label>
  <label>Height <input id="newH" type="number" min="6" max="64" value="12"></label>
  <p class="hint">The current tomb is replaced; Undo brings it back.</p>
  <menu><button value="cancel">Cancel</button><button id="newOk" value="ok" class="primary">Create</button></menu></form></dialog>
<div id="toast" role="status" aria-live="polite" hidden></div>
</body></html>
