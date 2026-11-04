<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/** What the link engine (Links::run) needs from the sim: the mirror of the `ws` object in sim.js. */
interface LinkHost
{
    public function tick(): int;

    /** R-LINK-6: a condition trigger's value. */
    public function cond(string $kind, int|bool $arg): bool;

    /**
     * R-LINK-8: apply effects in order; true if the state changed.
     *
     * @param list<array<string,mixed>> $effects
     */
    public function apply(array $effects): bool;

    public function dead(): bool;

    /** A link fired: emit its event. */
    public function fired(int $id): void;
}
