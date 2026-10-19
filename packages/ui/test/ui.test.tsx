import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { axe } from 'jest-axe';
import { describe, expect, it, vi } from 'vitest';
import {
  AppShell, Badge, Button, Card, CardBody, Checkbox, ConfirmDialog, CostBreakdown, Dialog, EmptyState, ErrorState,
  IconButton, Input, MealSlot, NutritionTable, RecipeCard, RecipeGrid, SearchField, Select, Sheet, ShoppingCategoryHeader,
  ShoppingItemRow, Skeleton, Stepper, Tabs, Textarea, ToastProvider, useToast, ViewToggle, formatPence,
} from '../src';

async function a11y(ui: React.ReactElement) {
  const { container, ...rest } = render(ui);
  expect(await axe(container)).toHaveNoViolations();
  return { container, ...rest };
}

describe('Button / IconButton', () => {
  it('renders, clicks, and is accessible', async () => {
    const onClick = vi.fn();
    await a11y(<><Button onClick={onClick}>Save</Button><IconButton label="Close" icon="x" /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onClick).toHaveBeenCalled();
  });
  it('loading disables and sets aria-busy', () => {
    render(<Button loading>Save</Button>);
    const b = screen.getByRole('button', { name: 'Save' });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute('aria-busy', 'true');
  });
  it('icon button exposes pressed state', () => {
    render(<IconButton label="Fav" icon="heart" pressed />);
    expect(screen.getByRole('button', { name: 'Fav' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('Fields', () => {
  it('Input/Textarea/Select link label, hint and error', async () => {
    await a11y(
      <form>
        <Input label="Title" hint="Short and sweet" />
        <Input label="Servings" error="Required" />
        <Textarea label="Notes" />
        <Select label="Meal" options={[{ value: 'd', label: 'Dinner' }]} placeholder="Choose" />
      </form>,
    );
    const bad = screen.getByLabelText('Servings');
    expect(bad).toHaveAttribute('aria-invalid', 'true');
    expect(bad).toHaveAccessibleDescription('Required');
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription('Short and sweet');
  });
  it('Checkbox toggles via label click', async () => {
    const onChange = vi.fn();
    await a11y(<Checkbox label="Milk" large onChange={onChange} />);
    await userEvent.click(screen.getByText('Milk'));
    expect(onChange).toHaveBeenCalled();
    expect(screen.getByRole('checkbox', { name: 'Milk' })).toBeChecked();
  });
  it('SearchField reports changes, clears and is a search landmark', async () => {
    function Host() { const [v, setV] = useState(''); return <SearchField value={v} onValueChange={setV} />; }
    await a11y(<Host />);
    expect(screen.getByRole('search')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'curry');
    expect(screen.getByRole('searchbox')).toHaveValue('curry');
    await userEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(screen.getByRole('searchbox')).toHaveValue('');
  });
});

describe('Badge / Card / Skeleton / states', () => {
  it('render accessibly', async () => {
    await a11y(
      <main>
        <Badge tone="accent">Vegan</Badge>
        <Card><CardBody>Hello</CardBody></Card>
        <Skeleton label="Loading recipes" />
        <EmptyState title="No recipes yet" description="Add your first." action={<Button>Add</Button>} />
      </main>,
    );
    expect(screen.getByRole('status', { name: 'Loading recipes' })).toBeInTheDocument();
  });
  it('ErrorState is an alert with retry', async () => {
    const retry = vi.fn();
    await a11y(<main><ErrorState onRetry={retry} /></main>);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('Dialog / Sheet / ConfirmDialog', () => {
  it('Dialog is labelled, modal and closes on Escape', async () => {
    const onOpenChange = vi.fn();
    render(<Dialog open onOpenChange={onOpenChange} title="Edit" description="Make changes"><Input label="Name" /></Dialog>);
    const d = screen.getByRole('dialog', { name: 'Edit' });
    expect(d).toHaveAccessibleDescription('Make changes');
    expect(await axe(d)).toHaveNoViolations();
    await userEvent.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
  it('Sheet renders as dialog', () => {
    render(<Sheet open onOpenChange={() => {}} title="Filters">x</Sheet>);
    expect(screen.getByRole('dialog', { name: 'Filters' })).toHaveClass('fr-sheet');
  });
  it('ConfirmDialog confirm and cancel', async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ConfirmDialog open onOpenChange={onOpenChange} title="Delete recipe?" confirmLabel="Delete" destructive onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe('Tabs', () => {
  it('switches panels with keyboard', async () => {
    await a11y(<Tabs label="Recipe sections" items={[{ value: 'a', label: 'Ingredients', content: 'AAA' }, { value: 'b', label: 'Method', content: 'BBB' }]} />);
    expect(screen.getByRole('tab', { name: 'Ingredients' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.click(screen.getByRole('tab', { name: 'Ingredients' }));
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Method' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('BBB')).toBeVisible();
  });
});

describe('Toast', () => {
  function Host() { const { toast } = useToast(); return <button onClick={() => toast({ message: 'Saved', actionLabel: 'Undo' })}>go</button>; }
  it('announces and dismisses', async () => {
    const { container } = render(<ToastProvider><Host /></ToastProvider>);
    await userEvent.click(screen.getByText('go'));
    expect(screen.getByRole('status')).toHaveTextContent('Saved');
    expect(await axe(container)).toHaveNoViolations();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Stepper', () => {
  it('increments, decrements and respects bounds', async () => {
    function Host() { const [n, setN] = useState(2); return <Stepper value={n} onChange={setN} min={1} max={3} />; }
    await a11y(<Host />);
    await userEvent.click(screen.getByRole('button', { name: 'Increase servings' }));
    expect(screen.getByRole('group', { name: 'Servings' })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: 'Increase servings' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Decrease servings' }));
    await userEvent.click(screen.getByRole('button', { name: 'Decrease servings' }));
    expect(screen.getByRole('button', { name: 'Decrease servings' })).toBeDisabled();
  });
});

describe('RecipeCard / grid / toggle', () => {
  it('shows cost as an estimate and favourite toggles', async () => {
    const fav = vi.fn();
    await a11y(
      <RecipeGrid>
        <RecipeCard title="Dal" href="/recipes/1" totalMinutes={45} costPerServingPence={87} tags={['Vegan']} onToggleFavourite={fav} />
      </RecipeGrid>,
    );
    expect(screen.getByText('£0.87 per serving')).toBeInTheDocument();
    expect(screen.getByText('estimate')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Dal' })).toHaveAttribute('href', '/recipes/1');
    await userEvent.click(screen.getByRole('button', { name: 'Add Dal to favourites' }));
    expect(fav).toHaveBeenCalled();
  });
  it('unknown cost is not shown as zero', () => {
    render(<RecipeCard title="Stew" href="/s" costPerServingPence={null} />);
    expect(screen.getByText('Cost unknown')).toBeInTheDocument();
    expect(screen.queryByText(/£0/)).toBeNull();
  });
  it('ViewToggle reflects and changes view', async () => {
    const onChange = vi.fn();
    await a11y(<ViewToggle view="grid" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Grid view' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'List view' }));
    expect(onChange).toHaveBeenCalledWith('list');
  });
});

describe('AppShell', () => {
  it('has main landmark, skip link and all eight nav items with current page', async () => {
    const { container } = render(<AppShell active="recipes"><h1>Recipes</h1></AppShell>);
    expect(await axe(container)).toHaveNoViolations();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toBeInTheDocument();
    const side = screen.getByRole('navigation', { name: 'Main' });
    for (const n of ['Home', 'Recipes', 'Meal planner', 'Shopping list', 'Pantry', 'Receipts', 'Household', 'Settings']) {
      expect(within(side).getByRole('link', { name: n })).toBeInTheDocument();
    }
    expect(within(side).getByRole('link', { name: 'Recipes' })).toHaveAttribute('aria-current', 'page');
    const bottom = screen.getByRole('navigation', { name: 'Main (mobile)' });
    expect(within(bottom).getByRole('link', { name: 'Pantry' })).toBeInTheDocument();
    expect(within(bottom).queryByRole('link', { name: 'Receipts' })).toBeNull();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });
});

describe('Shopping + MealSlot', () => {
  it('one tap ticks an item; partial action and category header work', async () => {
    const onToggle = vi.fn();
    const onPartial = vi.fn();
    await a11y(
      <main>
        <ShoppingCategoryHeader>Dairy</ShoppingCategoryHeader>
        <ul className="fr-shoplist">
          <ShoppingItemRow name="Milk" quantityLabel="2 l" partialLabel="1 l bought" checked={false} onToggle={onToggle} onPartial={onPartial} />
        </ul>
      </main>,
    );
    await userEvent.click(screen.getByRole('checkbox', { name: /Milk/ }));
    expect(onToggle).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole('button', { name: 'Bought some Milk' }));
    expect(onPartial).toHaveBeenCalled();
    expect(screen.getByText('2 l · 1 l bought')).toBeInTheDocument();
  });
  it('MealSlot empty and filled', async () => {
    const onAdd = vi.fn();
    const onRemove = vi.fn();
    const { rerender } = await a11y(<MealSlot label="Monday dinner" onAdd={onAdd} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add meal to Monday dinner' }));
    expect(onAdd).toHaveBeenCalled();
    rerender(<MealSlot label="Monday dinner" meal={{ title: 'Dal', servings: 4 }} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole('button', { name: 'Remove Dal from Monday dinner' }));
    expect(onRemove).toHaveBeenCalled();
  });
});

describe('NutritionTable', () => {
  const rows = [
    { label: 'Energy', status: 'known' as const, value: 412.34, unit: 'kcal', estimate: true },
    { label: 'Fat', status: 'zero' as const, unit: 'g' },
    { label: 'Fibre', status: 'unknown' as const, unit: 'g' },
    { label: 'Salt', status: 'unavailable' as const, unit: 'g' },
    { label: 'Sugars', status: 'unknown' as const, value: 0, unit: 'g' },
  ];
  it('is accessible', async () => { await a11y(<NutritionTable rows={rows} />); });
  it('renders unknown as Unknown or dash, NEVER 0; zero is shown only when explicitly zero', () => {
    render(<NutritionTable rows={rows} />);
    const cell = (label: string) => screen.getByRole('row', { name: new RegExp(`^${label}`) });
    expect(cell('Fibre')).toHaveTextContent('Unknown');
    expect(cell('Fibre')).not.toHaveTextContent('0');
    expect(cell('Salt')).toHaveTextContent('—');
    expect(cell('Salt')).not.toHaveTextContent('0');
    expect(cell('Sugars')).toHaveTextContent('Unknown'); // even if a stray value 0 is supplied
    expect(cell('Sugars')).not.toHaveTextContent('0 g');
    expect(cell('Fat')).toHaveTextContent('0 g');
    expect(cell('Energy')).toHaveTextContent('412.3 kcal');
    expect(cell('Energy')).toHaveTextContent('estimate');
  });
  it('known status with missing value falls back to Unknown', () => {
    render(<NutritionTable rows={[{ label: 'Protein', status: 'known', unit: 'g' }]} />);
    expect(screen.getByRole('row', { name: /Protein/ })).toHaveTextContent('Unknown');
  });
});

describe('CostBreakdown', () => {
  it('labels estimate/source, sums known, flags missing prices', async () => {
    await a11y(
      <CostBreakdown servings={4} lines={[
        { label: 'Lentils', pricePence: 120, kind: 'receipt', source: 'Tesco receipt 2026-10-01' },
        { label: 'Onions', pricePence: 60, kind: 'generic_estimate' },
        { label: 'Saffron', pricePence: null },
      ]} />,
    );
    expect(screen.getByText('Receipt')).toBeInTheDocument();
    expect(screen.getAllByText('estimate').length).toBeGreaterThan(0);
    expect(screen.getByText('No price')).toBeInTheDocument();
    expect(screen.getByText('Total (partial)')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /Per serving/ })).toHaveTextContent('£0.45');
    expect(screen.getByText(/total is a lower bound/)).toBeInTheDocument();
  });
  it('no prices at all is Unknown, not £0.00', () => {
    render(<CostBreakdown servings={2} lines={[{ label: 'X', pricePence: null }]} />);
    expect(screen.queryByText('£0.00')).toBeNull();
    expect(screen.getByRole('row', { name: /Per serving/ })).toHaveTextContent('Unknown');
  });
  it('formatPence is integer-safe', () => {
    expect(formatPence(5)).toBe('£0.05');
    expect(formatPence(12345)).toBe('£123.45');
  });
});
