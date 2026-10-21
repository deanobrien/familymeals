-- PRJ-018 P2-A (D393): the opt-in "You're near <store> - N items on your list" nudge is a member-controlled notification
-- type like the others (off by default). It is raised on the phone from a geofence, never by the delivery job, so the
-- server never creates a `notifications` row of this type; the type only has to be valid so a member's choice can be saved
-- in notification_preferences. Replaces the validity function from 20261021001200 with the same list plus 'near_store'.
create or replace function public.notification_type_is_valid(p_type text)
returns boolean
language sql immutable
set search_path = ''
as $$
  select p_type in ('expiry', 'list_changed_while_shopping', 'purchase_by_other', 'item_added', 'plan_approved',
                    'recipe_added', 'member_joined', 'restock', 'near_store', 'test')
$$;
