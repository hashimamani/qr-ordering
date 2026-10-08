import { useMemo, useState } from 'react';
import type { MenuCategory, MenuItem } from '../api/types';

/**
 * The customer's view of a menu that may be large.
 *
 * Chillax Zone has 273 items; rendering them as one list is a wall
 * nobody scrolls to the bottom of. So: main categories as a tab row,
 * sub-categories collapsible beneath, and a search box that cuts across
 * the whole menu -- for a customer who already knows they want a Tusker,
 * typing four letters beats two taps and a scroll.
 *
 * Degrades on its own for small menus. A restaurant whose categories
 * have no parents gets one tab per category and no collapsing to fight
 * with, which is what the single-level tenants had before any of this.
 */

interface Props {
  categories: MenuCategory[];
  items: MenuItem[];
  quantityFor: (itemId: string) => number;
  onQuantityChange: (itemId: string, qty: number) => void;
}

function ItemRow({
  item,
  qty,
  onChange,
}: {
  item: MenuItem;
  qty: number;
  onChange: (qty: number) => void;
}) {
  return (
    <div className={`card item-row ${item.is_available ? '' : 'unavailable'}`}>
      <div>
        <div className="item-name">{item.name}</div>
        {item.description && <div className="item-desc">{item.description}</div>}
        <div className="item-price">
          KSh {Number(item.price).toLocaleString()}
          {!item.is_available && ' (unavailable)'}
        </div>
      </div>
      {item.is_available && (
        <div className="qty-controls">
          <button onClick={() => onChange(qty - 1)} aria-label={`Remove one ${item.name}`}>
            −
          </button>
          <span>{qty}</span>
          <button onClick={() => onChange(qty + 1)} aria-label={`Add one ${item.name}`}>
            +
          </button>
        </div>
      )}
    </div>
  );
}

export function MenuBrowser({ categories, items, quantityFor, onQuantityChange }: Props) {
  const [activeMainId, setActiveMainId] = useState<string | null>(null);
  const [openSubs, setOpenSubs] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  const itemsByCategory = useMemo(() => {
    const map = new Map<string, MenuItem[]>();
    for (const item of items) {
      if (!map.has(item.category_id)) map.set(item.category_id, []);
      map.get(item.category_id)!.push(item);
    }
    return map;
  }, [items]);

  const tree = useMemo(() => {
    const mains = categories.filter((c) => !c.parent_id);
    const childrenOf = new Map<string, MenuCategory[]>();
    for (const c of categories) {
      if (!c.parent_id) continue;
      if (!childrenOf.has(c.parent_id)) childrenOf.set(c.parent_id, []);
      childrenOf.get(c.parent_id)!.push(c);
    }
    return mains
      .map((main) => {
        const subs = (childrenOf.get(main.id) ?? []).filter(
          (s) => (itemsByCategory.get(s.id) ?? []).length > 0,
        );
        const direct = itemsByCategory.get(main.id) ?? [];
        return { main, subs, direct, total: direct.length + subs.reduce((n, s) => n + (itemsByCategory.get(s.id) ?? []).length, 0) };
      })
      // An empty category is noise on a menu -- it offers the customer a
      // tab that leads nowhere.
      .filter((group) => group.total > 0);
  }, [categories, itemsByCategory]);

  const activeGroup = tree.find((g) => g.main.id === activeMainId) ?? tree[0];

  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (q.length < 2) return null;
    return items.filter(
      (i) => i.name.toLowerCase().includes(q) || (i.description ?? '').toLowerCase().includes(q),
    );
  }, [search, items]);

  function toggleSub(id: string) {
    setOpenSubs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (tree.length === 0) return null;

  return (
    <>
      {/* Only worth showing once there is enough menu to get lost in. */}
      {items.length > 20 && (
        <input
          className="menu-search"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search the menu…"
          aria-label="Search the menu"
        />
      )}

      {searchResults ? (
        searchResults.length === 0 ? (
          <div className="empty-state">Nothing matches “{search.trim()}”.</div>
        ) : (
          <>
            <div className="category-title">
              {searchResults.length} result{searchResults.length === 1 ? '' : 's'}
            </div>
            {searchResults.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                qty={quantityFor(item.id)}
                onChange={(q) => onQuantityChange(item.id, q)}
              />
            ))}
          </>
        )
      ) : (
        <>
          {/* One main category needs no tab row to choose between. */}
          {tree.length > 1 && (
            <div className="menu-tabs" role="tablist">
              {tree.map((group) => (
                <button
                  key={group.main.id}
                  role="tab"
                  aria-selected={group.main.id === activeGroup.main.id}
                  className={group.main.id === activeGroup.main.id ? 'active' : ''}
                  onClick={() => setActiveMainId(group.main.id)}
                >
                  {group.main.name}
                </button>
              ))}
            </div>
          )}

          {/* Items sitting directly on the main category, before its
              sub-categories -- this is what a one-level menu looks like. */}
          {activeGroup.direct.map((item) => (
            <ItemRow
              key={item.id}
              item={item}
              qty={quantityFor(item.id)}
              onChange={(q) => onQuantityChange(item.id, q)}
            />
          ))}

          {activeGroup.subs.map((sub) => {
            const subItems = itemsByCategory.get(sub.id) ?? [];
            const open = openSubs.has(sub.id);
            return (
              <div key={sub.id} className="menu-group">
                <button
                  className="menu-group-header"
                  onClick={() => toggleSub(sub.id)}
                  aria-expanded={open}
                >
                  <span className={`menu-group-caret ${open ? 'open' : ''}`} aria-hidden="true">
                    ▸
                  </span>
                  <span className="menu-group-name">{sub.name}</span>
                  <span className="menu-group-count">{subItems.length}</span>
                </button>
                {open &&
                  subItems.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      qty={quantityFor(item.id)}
                      onChange={(q) => onQuantityChange(item.id, q)}
                    />
                  ))}
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
