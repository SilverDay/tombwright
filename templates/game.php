<?php
// The game page (spec §5.3). Static markup ported from Gloamhollow; no user text yet.
// Served by public/index.php with the security headers (CSP: no inline script or style).
declare(strict_types=1);
?><!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Gloamhollow · Tombwright</title>
<link rel="stylesheet" href="/assets/css/game.css">
<script type="module" src="/js/game/main.js"></script>
</head><body>
<canvas id="view" aria-label="First-person view of the tomb"></canvas>
<div id="veil" aria-hidden="true"></div>
<div id="vig" aria-hidden="true"></div>
<div id="flash" aria-hidden="true"></div>
<div class="hud" id="cross" aria-hidden="true"></div>

<div class="hud" id="top">
  <div id="msg" role="status" aria-live="polite"></div>
  <div id="status"></div>
</div>
<div class="hud" id="tframe" hidden>
  <div class="tf-name">Ilvaris, the Candle-Eater</div>
  <div class="bar"><i id="tfBar"></i></div>
  <div id="tfState"></div>
</div>
<div class="hud" id="corner">
  <button id="miniBtn" type="button" tabindex="-1" aria-label="Open the full map"><canvas id="mini" width="248" height="248"></canvas></button>
  <div class="chips">
    <button class="chip" id="mapBtn" type="button" tabindex="-1">Map</button>
    <button class="chip" id="notesBtn" type="button" tabindex="-1">Notes</button>
    <button class="chip" id="menuBtn" type="button" tabindex="-1">Menu</button>
  </div>
</div>
<div class="hud" id="pframe" hidden>
  <div class="pf-head"><span>Health</span><span id="pfTre"></span></div>
  <div class="bar"><i id="hpBar"></i><span id="hpTxt"></span></div>
  <div class="bar oil" id="oilBarBox"><i id="oilBar"></i><span id="oilTxt"></span></div>
</div>
<div class="hud" id="bar" hidden>
  <button class="slot atk" id="sAtk" type="button" tabindex="-1"><span class="ky" id="kAtk">LMB</span><span class="nm">Strike</span><span class="cd"></span></button>
  <button class="slot" id="sHood" type="button" tabindex="-1"><span class="ky">F</span><span class="nm" id="hoodNm">Hood</span></button>
  <button class="slot" id="sProbe" type="button" tabindex="-1"><span class="ky">Q</span><span class="nm">Probe</span><span class="cd"></span></button>
  <button class="slot" id="sPeb" type="button" tabindex="-1"><span class="ky">R</span><span class="nm">Pebble</span><span class="ct" id="pebCt"></span><span class="cd"></span></button>
  <button class="slot" id="sOil" type="button" tabindex="-1"><span class="ky">O</span><span class="nm">Oil</span><span class="ct" id="oilCt"></span></button>
</div>
<button class="hud" id="prompt" type="button" tabindex="-1" hidden></button>
<div class="hud" id="toast" aria-hidden="true"></div>
<div class="hud" id="hint" hidden>Click the view to look around · Esc frees the mouse</div>
<div class="hud" id="ghostMove" hidden>move</div>
<div class="hud" id="ghostLook" hidden>drag to look</div>
<div id="stick" hidden><div id="knob"></div></div>
<div id="fade"></div>

<div id="map" class="overlay" hidden>
  <div class="mapcard">
    <canvas id="big" aria-label="Map of the explored tomb"></canvas>
    <div class="legend">
      <span><i class="at">@</i> you</span><span><i class="dr">+</i> door</span><span><i class="tr">x</i> known trap</span>
      <span><i>O</i> pit</span><span><i class="gh">=</i> unlit road</span><span><i class="lo">$</i> treasure</span><span><i class="gh">&amp;</i> checkpoint</span>
    </div>
    <button class="btn" id="closeMap" type="button">Close map</button>
  </div>
</div>

<div id="read" class="overlay" hidden>
  <div class="card scroll" role="dialog" aria-modal="true" aria-labelledby="readTitle">
    <p class="kind" id="readKind"></p>
    <h2 id="readTitle"></h2>
    <p class="text" id="readText"></p>
    <p class="sig" id="readSig" hidden></p>
    <div class="pager" id="readPager" hidden><button class="btn small" id="readPrev" type="button">Previous</button><span id="readPage"></span><button class="btn small" id="readNext" type="button">Next</button></div>
    <div class="row"><button class="btn primary" id="readClose" type="button">Close</button></div>
  </div>
</div>

<div id="notes" class="overlay" hidden>
  <div class="card" role="dialog" aria-modal="true" aria-labelledby="notesTitle">
    <h2 id="notesTitle">Notes</h2>
    <p class="lede small">Everything you have read in the tomb, to read again.</p>
    <div class="notes" id="notesList"></div>
    <div class="row"><button class="btn" id="notesClose" type="button">Close</button></div>
  </div>
</div>

<div id="menu" class="overlay" hidden>
  <div class="card" role="dialog" aria-modal="true" aria-labelledby="menuTitle">
    <h2 id="menuTitle">Paused</h2>
    <div class="stats" id="menuStats"></div>
    <div class="row">
      <button class="btn primary" id="resumeBtn" type="button">Resume</button>
      <button class="btn" id="soundBtn" type="button">Sound: on</button>
      <button class="btn danger" id="restartBtn" type="button">Restart the tomb</button>
      <a class="btn leave" href="/">Leave the tomb</a>
    </div>
    <p class="note" id="restartNote" hidden>Press again to wipe this delve and start over at the stair.</p>
    <details id="menuKeys"><summary>Controls</summary><div class="keysHost"></div></details>
  </div>
</div>

<div id="death" class="overlay" hidden>
  <div class="card" role="dialog" aria-modal="true" aria-labelledby="deathTitle">
    <pre class="ascii" id="rip" aria-hidden="true"></pre>
    <h2 id="deathTitle">You are dead</h2>
    <p class="lede" id="deathCause"></p>
    <p class="note" id="deathLesson"></p>
    <dl class="summary" id="deathSum"></dl>
    <div class="row"><button class="btn primary" id="riseBtn" type="button">Rise again</button><button class="btn" id="deathRestart" type="button">Restart the tomb</button><a class="btn leave" href="/">Leave the tomb</a></div>
  </div>
</div>

<div id="win" class="overlay" hidden>
  <div class="card" role="dialog" aria-modal="true" aria-labelledby="winTitle">
<pre class="ascii" aria-hidden="true"><span class="e">      \  |  /</span>
<span class="e">    --  </span><span class="b">(*)</span><span class="e">  --     </span><span class="w">The Heart</span>
<span class="e">      /  |  \       </span><span class="w">of Embers</span>
<span class="w">   ____|_____|____</span></pre>
    <h2 id="winTitle">You climb into daylight</h2>
    <p class="lede" id="winLede"></p>
    <dl class="summary" id="winSum"></dl>
    <div class="row"><button class="btn primary" id="winNew" type="button">Delve again</button><a class="btn leave" href="/">Leave the tomb</a></div>
  </div>
</div>

<div id="intro" class="overlay">
  <div class="card" role="dialog" aria-modal="true" aria-labelledby="title">
<pre class="ascii" aria-hidden="true"><span class="w">###########</span><span class="g">  .  .  </span><span class="w">###########</span>
<span class="w">#</span> <span class="e">i</span>   <span class="e">i</span>   <span class="w">#</span><span class="g"> = = = </span><span class="w">#</span>  <span class="b">&amp;</span>      <span class="w">#</span>
<span class="w">#</span>  <span class="e">@</span>    <span class="w">D</span><span class="g">-=-=-=-=-</span><span class="w">D</span>   x  <span class="e">$</span>  <span class="w">#</span>
<span class="w">###########</span><span class="g">  .  .  </span><span class="w">###########</span></pre>
    <h1 id="title">Gloamhollow</h1>
    <p class="lede">Under the hill lies Ilvaris, the <em>Candle-Eater</em>, sealed in with every light she ever stole. Her tomb was built to kill thieves. Most of its traps kill outright, so read everything, test the floor with your pole and pebbles, and think about your lantern. When you die, you rise again at the last chamber you reached, and the traps you have found stay found.</p>
    <div class="cont" id="contBox" hidden>
      <p id="contTxt"></p>
      <div class="row"><button class="btn primary" id="contBtn" type="button">Continue</button><button class="btn" id="newBtn2" type="button">Start over</button></div>
    </div>
    <div class="row" id="newBox"><button class="btn primary" id="goBtn" type="button">Enter the tomb</button><a class="btn leave" href="/">Leave the tomb</a></div>
    <details id="introKeys"><summary>Controls</summary><div class="keysHost"></div></details>
    <p class="err" id="err" hidden></p>
  </div>
</div>

<template id="keysDesk">
  <dl class="keys">
    <dt>W A S D</dt><dd>Walk and strafe. Arrow keys walk and turn. Shift runs.</dd>
    <dt>Mouse</dt><dd>Look. Click the view to capture the mouse, then click to strike.</dd>
    <dt>E</dt><dd>Read, open, pull, ring, take: whatever is in front of you</dd>
    <dt>F</dt><dd>Hood or unhood your lantern</dd>
    <dt>Q</dt><dd>Probe the floor ahead with your pole</dd>
    <dt>R</dt><dd>Toss a pebble ahead; look down to toss it shorter. Walk over pebbles to pick them up.</dd>
    <dt>O</dt><dd>Pour a flask of oil into your lantern</dd>
    <dt>M · N</dt><dd>Map · notes you have read</dd>
  </dl>
</template>
<template id="keysTouch">
  <dl class="keys">
    <dt>Left thumb</dt><dd>Touch and drag on the left half to walk</dd>
    <dt>Right thumb</dt><dd>Drag on the right half to look</dd>
    <dt>Prompt</dt><dd>Tap the prompt at bottom left to read, open, pull, ring or take</dd>
    <dt>Buttons</dt><dd>Strike, hood the lantern, probe the floor ahead with your pole, toss a pebble (look down to toss it shorter), pour oil</dd>
    <dt>Notes</dt><dd>Read again anything you have found written in the tomb</dd>
  </dl>
</template>
</body></html>
