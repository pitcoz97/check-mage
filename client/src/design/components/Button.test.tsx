// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { Button } from './Button';

/** Varianti e taglie del pulsante: il rilievo del design e il minimo toccabile. */

afterEach(cleanup);

describe('Button', () => {
  it.each([
    ['primary', 'bg-play', 'shadow-edge-play'],
    ['secondary', 'bg-elevated', 'shadow-edge-elevated'],
    ['gold', 'bg-gold', 'shadow-edge-gold'],
    ['danger', 'bg-danger-surface', 'shadow-edge-danger'],
  ] as const)('%s ha superficie e bordo 3D propri', (variant, surface, edge) => {
    render(<Button variant={variant}>ok</Button>);
    const button = screen.getByRole('button', { name: 'ok' });
    expect(button.className).toContain(surface);
    expect(button.className).toContain(edge);
  });

  it('di default è primario, alto 48px e mai sotto il minimo toccabile', () => {
    render(<Button>ok</Button>);
    const button = screen.getByRole('button', { name: 'ok' });
    expect(button.className).toContain('bg-play');
    expect(button.className).toContain('min-h-12');
    expect(button.className).toContain('min-w-[var(--hit-target)]');
    expect(button).toHaveProperty('type', 'button');
  });

  it('la taglia grande è quella della CTA (60px)', () => {
    render(<Button size="lg">Gioca</Button>);
    expect(screen.getByRole('button', { name: 'Gioca' }).className).toContain('min-h-15');
  });
});
