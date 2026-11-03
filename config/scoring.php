<?php

declare(strict_types=1);

/**
 * Versioned scoring constants (spec §4.6). Never edit a published version; add a new one.
 * A run stores score_formula_v, so old results keep the formula they were scored with.
 */
return [
    1 => ['base' => 1000, 'per_death' => 150, 'per_second' => 1, 'ticks_per_second' => 30],
];
