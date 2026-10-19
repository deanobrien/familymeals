'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Button,
  ConfirmDialog,
  Icon,
  NutritionTable,
  Stepper,
  Tabs,
  formatMinutes,
  formatPence,
  useToast,
} from '@fr/ui';
import { nutritionRows } from '../../../lib/recipes/nutrition';
import { scaleQuantityLabel, servingsFactor } from '../../../lib/recipes/scale';
import {
  costPerServing,
  totalMinutes,
  type RecipeView,
} from '../../../lib/recipes/types';
import { deleteRecipeAction, duplicateRecipeAction, toggleFavouriteAction } from '../actions';
import styles from '../recipes.module.css';

const PRICE_LABEL = {
  user_confirmed: 'your price',
  receipt: 'receipt price',
  retailer_verified: 'retailer price',
  generic_estimate: 'estimate',
} as const;

export function RecipeDetail({ recipe, justDuplicated = false }: { recipe: RecipeView; justDuplicated?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [servings, setServings] = useState(recipe.servings);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();
  const factor = servingsFactor(recipe.servings, servings);
  const total = totalMinutes(recipe);
  const perServing = costPerServing(recipe);
  const scaledTotal = recipe.cost.totalPence != null ? Math.round(recipe.cost.totalPence * factor) : null;
  const priceTag = PRICE_LABEL[recipe.cost.kind];

  const fav = () =>
    startTransition(async () => {
      const res = await toggleFavouriteAction(recipe.id);
      if (!res.ok) toast.toast({ message: 'Could not update favourite', tone: 'error' });
      router.refresh();
    });

  const duplicate = () =>
    startTransition(async () => {
      await duplicateRecipeAction(recipe.id);
    });

  const remove = () =>
    startTransition(async () => {
      const res = await deleteRecipeAction(recipe.id);
      // Only reached on failure: success redirects.
      if (res && !res.ok) {
        setConfirmDelete(false);
        toast.toast({ message: res.message, tone: 'error' });
      }
    });

  return (
    <article>
      <p><Link href="/recipes">Back to recipes</Link></p>
      {justDuplicated && <p className={styles.banner} role="status">Recipe duplicated. You are viewing the copy.</p>}

      <div className={styles.detailTop}>
        <div className={styles.hero}>
          {recipe.imageUrl ? <img src={recipe.imageUrl} alt={recipe.title} /> : <Icon name="image" width={48} height={48} aria-label="No photo" role="img" />}
        </div>
        <div>
          <h1>{recipe.title}</h1>
          {recipe.description && <p>{recipe.description}</p>}
          <p className="fr-muted">
            Source: {recipe.sourceUrl ? <a href={recipe.sourceUrl} rel="noreferrer noopener" target="_blank">{recipe.sourceAttribution || recipe.sourceUrl}</a> : recipe.sourceAttribution || 'Not recorded'}
          </p>
          <ul className={styles.meta} aria-label="Recipe times">
            <li>Prep <strong>{recipe.prepMinutes != null ? formatMinutes(recipe.prepMinutes) : 'Unknown'}</strong></li>
            <li>Cook <strong>{recipe.cookMinutes != null ? formatMinutes(recipe.cookMinutes) : 'Unknown'}</strong></li>
            {total != null && <li>Total <strong>{formatMinutes(total)}</strong></li>}
            <li>Serves <strong>{recipe.servings}</strong></li>
            {recipe.rating != null && <li>Rating <strong aria-label={`${recipe.rating} out of 5`}>{recipe.rating}/5</strong></li>}
          </ul>
          <ul className={styles.tagList} aria-label="Tags">
            <li><Badge tone="accent">{recipe.diet}</Badge></li>
            {recipe.cuisine && <li><Badge>{recipe.cuisine}</Badge></li>}
            <li><Badge>{recipe.mealType}</Badge></li>
            {recipe.tags.map((t) => <li key={t}><Badge>{t}</Badge></li>)}
          </ul>
          <div className={styles.actions}>
            <Button variant={recipe.favourite ? 'primary' : 'secondary'} aria-pressed={recipe.favourite} onClick={fav} disabled={pending}>
              <Icon name="heart" /> {recipe.favourite ? 'Favourited' : 'Favourite'}
            </Button>
            <Link href={`/plan?add=${recipe.id}`} className="fr-btn fr-btn--secondary">
              <Icon name="calendar" /> Add to plan
            </Link>
            <Link href={`/recipes/${recipe.id}/edit`} className="fr-btn fr-btn--secondary">Edit</Link>
            <Button variant="secondary" onClick={duplicate} disabled={pending}>Duplicate</Button>
            <Button variant="danger" onClick={() => setConfirmDelete(true)} disabled={pending}>
              <Icon name="trash" /> Delete
            </Button>
          </div>
        </div>
      </div>

      <div className={styles.cols}>
        <section aria-labelledby="ing-h">
          <h2 id="ing-h">Ingredients</h2>
          <div className={styles.servingsRow}>
            <Stepper label="Servings" value={servings} min={1} max={100} onChange={setServings} />
            {servings !== recipe.servings && (
              <Button variant="ghost" size="sm" onClick={() => setServings(recipe.servings)}>Reset to {recipe.servings}</Button>
            )}
          </div>
          {servings !== recipe.servings && (
            <p className="fr-muted" role="status">Amounts scaled for {servings} servings and rounded for easy measuring. Pinches and to-taste items are unchanged.</p>
          )}
          <ul className={styles.ingredients} aria-label="Ingredients">
            {recipe.ingredients.map((i) => (
              <li key={i.id} title={`Original: ${i.quantity.originalText}`}>
                <span className={styles.qty} data-testid="ingredient-qty">{scaleQuantityLabel(i.quantity, factor)}</span>
                <span>
                  {i.name}
                  {i.preparation ? `, ${i.preparation}` : ''}
                  {i.optional && <span className={styles.optional}> (optional)</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="method-h">
          <h2 id="method-h">Method</h2>
          <ol className={styles.steps}>
            {recipe.steps.map((s) => <li key={s.id}>{s.text}</li>)}
          </ol>
        </section>
      </div>

      <div className={styles.cols} style={{ marginTop: 'var(--fr-space-6)' }}>
        <section className={styles.panel} aria-labelledby="cost-h">
          <h2 id="cost-h">Cost</h2>
          {perServing != null && scaledTotal != null ? (
            <>
              <p className={styles.costBig} data-testid="cost-per-serving">{formatPence(perServing)} per serving</p>
              <p data-testid="cost-total">
                {formatPence(scaledTotal)} for {servings} {servings === 1 ? 'serving' : 'servings'}{' '}
                <Badge tone={recipe.cost.kind === 'generic_estimate' ? 'warning' : 'success'}>{priceTag}</Badge>
              </p>
              {recipe.cost.source && <p className="fr-muted">{recipe.cost.source}</p>}
            </>
          ) : (
            <p className={styles.costBig} data-testid="cost-unknown">Cost unknown</p>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="nut-h">
          <h2 id="nut-h">Nutrition</h2>
          {recipe.nutritionPerServing.length === 0 && (
            <p className="fr-muted">Nutrition has not been calculated for this recipe yet.</p>
          )}
          <Tabs
            label="Nutrition basis"
            items={[
              { value: 'serving', label: 'Per serving', content: <NutritionTable caption="Nutrition per serving" rows={nutritionRows(recipe.nutritionPerServing, 1)} /> },
              { value: 'recipe', label: 'Per recipe', content: <NutritionTable caption={`Nutrition per recipe (${recipe.servings} servings)`} rows={nutritionRows(recipe.nutritionPerServing, recipe.servings)} /> },
            ]}
          />
          <p className="fr-muted" style={{ fontSize: 'var(--fr-text-xs)' }}>Estimates for information only, not medical advice.</p>
        </section>
      </div>

      {recipe.originalText && (
        <details className={styles.panel}>
          <summary>Original recipe text</summary>
          <p className={styles.original}>{recipe.originalText}</p>
        </details>
      )}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete "${recipe.title}"?`}
        description="This removes the recipe from your library. This cannot be undone."
        confirmLabel="Delete recipe"
        destructive
        loading={pending}
        onConfirm={remove}
      />
    </article>
  );
}
