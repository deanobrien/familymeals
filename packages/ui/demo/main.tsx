import { StrictMode, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import '../src/styles/index.css';
import {
  AppShell, Badge, Button, Card, CardBody, Checkbox, ConfirmDialog, CostBreakdown, Dialog, EmptyState, ErrorState, IconButton,
  Input, MealSlot, NutritionTable, RecipeCard, RecipeGrid, SearchField, Select, Sheet, ShoppingCategoryHeader, ShoppingItemRow,
  Skeleton, Stepper, Tabs, Textarea, ToastProvider, useToast, ViewToggle, type RecipeView, type NavKey,
} from '../src';

function Section({ title, children }: { title: string; children: ReactNode }) {
  return <section style={{ marginBottom: 'var(--fr-space-7)' }}><h2>{title}</h2><div style={{ display: 'grid', gap: 'var(--fr-space-4)' }}>{children}</div></section>;
}
const row = { display: 'flex', flexWrap: 'wrap', gap: 'var(--fr-space-3)', alignItems: 'center' } as const;

function ToastDemo() {
  const { toast } = useToast();
  return <Button variant="secondary" onClick={() => toast({ message: 'Added to shopping list', actionLabel: 'Undo' })}>Show toast</Button>;
}

function Gallery() {
  const [view, setView] = useState<RecipeView>('grid');
  const [q, setQ] = useState('');
  const [servings, setServings] = useState(4);
  const [fav, setFav] = useState(false);
  const [dlg, setDlg] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [milk, setMilk] = useState(false);
  const [eggs, setEggs] = useState(true);
  const [dark, setDark] = useState(false);
  const [active, setActive] = useState<NavKey>('recipes');
  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? 'dark' : 'light';
  };
  const v = view === 'list' ? 'row' : 'card';
  const cards = [
    <RecipeCard key="1" title="Red lentil dal" href="#" totalMinutes={40} costPerServingPence={87} tags={['Vegan', 'Budget']} favourite={fav} onToggleFavourite={() => setFav(!fav)} variant={v} />,
    <RecipeCard key="2" title="Sunday roast chicken" href="#" totalMinutes={135} costPerServingPence={246} tags={['Family']} onToggleFavourite={() => {}} variant={v} />,
    <RecipeCard key="3" title="Mystery stew (no prices yet)" href="#" totalMinutes={90} costPerServingPence={null} variant={v} />,
  ];
  return (
    <AppShell active={active}>
      <h1>Component gallery</h1>
      <div style={{ ...row, marginBottom: 'var(--fr-space-5)' }}>
        <Button variant="secondary" onClick={toggleTheme}>{dark ? 'Light' : 'Dark'} theme</Button>
        {(['home', 'recipes', 'planner'] as NavKey[]).map((k) => <Button key={k} size="sm" variant="ghost" onClick={() => setActive(k)}>Active: {k}</Button>)}
      </div>

      <Section title="Buttons">
        <div style={row}><Button>Primary</Button><Button variant="secondary">Secondary</Button><Button variant="ghost">Ghost</Button><Button variant="danger">Delete</Button><Button loading>Saving</Button><Button disabled>Disabled</Button><IconButton label="Favourite" icon="heart" variant="secondary" /></div>
      </Section>
      <Section title="Fields">
        <Input label="Recipe title" hint="Shown on the card" />
        <Input label="Servings" error="Enter a number" defaultValue="x" />
        <Textarea label="Notes" />
        <Select label="Meal type" placeholder="Choose..." options={[{ value: 'b', label: 'Breakfast' }, { value: 'd', label: 'Dinner' }]} />
        <SearchField value={q} onValueChange={setQ} placeholder="Search recipes, ingredients, tags" />
        <Checkbox label="Large tap target checkbox" large />
        <div style={row}><Stepper value={servings} onChange={setServings} /><Badge>Neutral</Badge><Badge tone="accent">Accent</Badge><Badge tone="success">Success</Badge><Badge tone="warning">estimate</Badge><Badge tone="danger">Danger</Badge></div>
      </Section>
      <Section title="Overlays and feedback">
        <div style={row}><Button variant="secondary" onClick={() => setDlg(true)}>Dialog</Button><Button variant="secondary" onClick={() => setSheet(true)}>Sheet</Button><Button variant="secondary" onClick={() => setConfirm(true)}>Confirm</Button><ToastDemo /></div>
        <Tabs label="Recipe sections" items={[{ value: 'i', label: 'Ingredients', content: 'Ingredient list here.' }, { value: 'm', label: 'Method', content: 'Steps here.' }, { value: 'n', label: 'Nutrition', content: 'Nutrition here.' }]} />
        <div style={{ display: 'grid', gap: 8 }}><Skeleton height={20} width="60%" /><Skeleton height={120} label="Loading preview" /></div>
        <Card><EmptyState title="No recipes yet" description="Add your first recipe to get started." action={<Button>Add recipe</Button>} /></Card>
        <Card><ErrorState onRetry={() => {}} /></Card>
        <Card><CardBody>A plain card with body padding.</CardBody></Card>
      </Section>
      <Section title="Recipes">
        <div style={{ ...row, justifyContent: 'space-between' }}><span className="fr-muted">3 recipes</span><ViewToggle view={view} onChange={setView} /></div>
        <RecipeGrid view={view}>{cards}</RecipeGrid>
      </Section>
      <Section title="Shopping list and planner">
        <div>
          <ShoppingCategoryHeader>Dairy and eggs</ShoppingCategoryHeader>
          <ul className="fr-shoplist">
            <ShoppingItemRow name="Milk" quantityLabel="2 l" partialLabel="1 l bought" checked={milk} onToggle={setMilk} onPartial={() => {}} />
            <ShoppingItemRow name="Eggs" quantityLabel="6" checked={eggs} onToggle={setEggs} />
          </ul>
        </div>
        <div style={{ display: 'grid', gap: 8, gridTemplateColumns: 'repeat(auto-fit, minmax(14rem, 1fr))' }}>
          <MealSlot label="Mon dinner" meal={{ title: 'Red lentil dal', servings: 4 }} onRemove={() => {}} onOpen={() => {}} />
          <MealSlot label="Tue dinner" onAdd={() => {}} />
        </div>
      </Section>
      <Section title="Nutrition and cost">
        <NutritionTable rows={[
          { label: 'Energy', status: 'known', value: 412, unit: 'kcal', estimate: true },
          { label: 'Fat', status: 'zero', unit: 'g' },
          { label: 'Fibre', status: 'unknown', unit: 'g' },
          { label: 'Salt', status: 'unavailable', unit: 'g' },
        ]} />
        <CostBreakdown servings={4} lines={[
          { label: 'Red lentils', pricePence: 120, kind: 'receipt', source: 'Receipt 1 Oct' },
          { label: 'Onions', pricePence: 60, kind: 'generic_estimate' },
          { label: 'Saffron', pricePence: null },
        ]} />
      </Section>

      <Dialog open={dlg} onOpenChange={setDlg} title="Edit servings" description="Quantities scale automatically."><Stepper value={servings} onChange={setServings} /></Dialog>
      <Sheet open={sheet} onOpenChange={setSheet} title="Filters"><Select label="Meal type" options={[{ value: 'd', label: 'Dinner' }]} /></Sheet>
      <ConfirmDialog open={confirm} onOpenChange={setConfirm} title="Delete this recipe?" description="This cannot be undone." confirmLabel="Delete" destructive onConfirm={() => setConfirm(false)} />
    </AppShell>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><ToastProvider><Gallery /></ToastProvider></StrictMode>);
