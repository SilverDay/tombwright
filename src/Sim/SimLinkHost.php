<?php

declare(strict_types=1);

namespace Tombwright\Sim;

/** The sim's side of the link engine (the `ws` object in sim.js): conditions, effects, events. */
final class SimLinkHost implements LinkHost
{
    /** @var array<string,mixed> */
    private array $state;
    /** @var list<array<string,mixed>> */
    private array $events;

    /**
     * @param array<string,mixed> $state held by reference
     * @param list<array<string,mixed>> $events held by reference
     */
    public function __construct(private readonly World $world, array &$state, array &$events)
    {
        $this->state = &$state;
        $this->events = &$events;
    }

    public function tick(): int
    {
        return $this->state['tick'];
    }

    public function cond(string $kind, int|bool $arg): bool
    {
        return Sim::linkCond($this->world, $this->state, $kind, $arg);
    }

    public function apply(array $effects): bool
    {
        return Sim::applyEffects($this->world, $this->state, $effects, $this->events);
    }

    public function dead(): bool
    {
        return $this->state['dead'] !== null;
    }

    public function fired(int $id): void
    {
        $this->events[] = ['e' => 'link', 'id' => $id];
    }
}
