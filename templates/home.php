<?php
// The landing page (`/`). Static markup; no user text yet. Served by public/index.php with the security headers.
declare(strict_types=1);
/** @var string $siteUrl the canonical site URL, set by public/index.php */
$og = htmlspecialchars($siteUrl . '/assets/images/tombwright-og-1200x630.jpg', ENT_QUOTES | ENT_HTML5, 'UTF-8');
$url = htmlspecialchars($siteUrl . '/', ENT_QUOTES | ENT_HTML5, 'UTF-8');
?><!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tombwright · build trap-filled tombs, then dare others to cross them</title>
<meta name="description" content="Build a trap-filled tomb in your browser, prove it can be beaten, publish it and challenge other players. Every scored run is replayed on the server.">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Tombwright">
<meta property="og:title" content="Tombwright">
<meta property="og:description" content="Build a trap-filled tomb, prove it can be beaten, and dare others to cross it.">
<meta property="og:url" content="<?= $url ?>">
<meta property="og:image" content="<?= $og ?>">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Tombwright: a hooded builder draws a tomb plan whose lines rise into stone halls, where an adventurer fights a skeleton">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="<?= $og ?>">
<link rel="stylesheet" href="/assets/css/home.css">
</head><body>
<header class="hero">
  <picture>
    <source srcset="/assets/images/tombwright-banner-1600.webp" type="image/webp">
    <img src="/assets/images/tombwright-banner-1600.jpg" width="1600" height="533" alt="Tombwright: a hooded builder draws a tomb plan whose lines rise into stone halls, where an adventurer fights a skeleton">
  </picture>
</header>
<main>
  <p class="lede">Build a trap-filled tomb in your browser. Prove it can be beaten by clearing it yourself. Publish it, and dare others to cross it. Every run that counts is replayed on the server from the moves you made, so nobody can fake a score.</p>

  <section class="play">
    <h2>Play now</h2>
    <p>The first tomb is <em>Gloamhollow</em>, the tomb of Ilvaris the Candle-Eater: pressure plates, waking eyes, bells, mirrors and the dark itself. Read everything, test the floor, mind your lantern.</p>
    <p><a class="btn primary" href="/play/gloamhollow">Enter Gloamhollow</a></p>
  </section>

  <section class="soon">
    <h2>Coming</h2>
    <ul>
      <li><b>The tomb builder</b>: lay out rooms, traps, puzzles and foes on a grid, wire them together, and playtest as you go.</li>
      <li><b>Publishing and challenges</b>: accounts, verified runs, leaderboards, and tombs you send to other players.</li>
    </ul>
  </section>
</main>
<footer>
  <p>Tombwright is made by SilverDay Media. Code under the MIT licence. Foe names and base stats from Rogue (<a href="/legal/rogue-licence.txt">licence</a>).</p>
</footer>
</body></html>
