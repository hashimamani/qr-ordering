import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import { DESTINATION_LABELS } from '../../api/types';
import type { MenuCategory, MenuItem, Destination } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { RowMenu } from '../../components/RowMenu';
import { useToast } from '../../components/ToastProvider';
import { PencilIcon, TrashIcon } from '../../components/icons';

// Built from DESTINATION_LABELS so a new station appears in both the add
// and edit forms without either being updated by hand -- the two selects
// were previously separate hardcoded copies.
const DESTINATION_OPTIONS = (Object.keys(DESTINATION_LABELS) as Destination[]).map((d) => (
  <option key={d} value={d}>
    {DESTINATION_LABELS[d]}
  </option>
));

export function AdminMenuTab() {
  const showToast = useToast();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loadError, setLoadError] = useState('');

  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryParent, setNewCategoryParent] = useState('');
  const [filter, setFilter] = useState('');
  const [editingCategory, setEditingCategory] = useState<MenuCategory | null>(null);
  const [newItem, setNewItem] = useState({
    category_id: '',
    name: '',
    description: '',
    price: '',
    destination: 'kitchen' as Destination,
  });
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<MenuCategory | null>(null);
  const [deleteItemTarget, setDeleteItemTarget] = useState<MenuItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const load = useCallback(() => {
    apiFetch<{ categories: MenuCategory[]; items: MenuItem[] }>('/admin/menu', { auth: true })
      .then((data) => {
        setCategories(data.categories);
        setItems(data.items);
      })
      .catch((err: ApiError) => setLoadError(err.message));
  }, []);

  useEffect(load, [load]);

  const mains = categories.filter((c) => !c.parent_id);
  const subsOf = (id: string) => categories.filter((c) => c.parent_id === id);

  /** "Drinks › Beer Bottles", so a select option says where an item lands. */
  const categoryPath = (c: MenuCategory) => {
    const parent = c.parent_id ? categories.find((p) => p.id === c.parent_id) : undefined;
    return parent ? `${parent.name} \u203a ${c.name}` : c.name;
  };

  /**
   * Ordered main-then-children so a long select reads as the tree rather
   * than an alphabetical jumble of 24 names.
   */
  const categoryOptions = mains.flatMap((main) => [main, ...subsOf(main.id)]);
  const filterQuery = filter.trim().toLowerCase();

  async function saveCategory() {
    if (!editingCategory) return;
    setSaving(true);
    try {
      await apiFetch(`/admin/menu-categories/${editingCategory.id}`, {
        method: 'PATCH',
        auth: true,
        // parent_id is always sent from this dialog, including null --
        // that is how a sub-category is promoted back to a main one.
        body: { name: editingCategory.name.trim(), parent_id: editingCategory.parent_id },
      });
      setEditingCategory(null);
      load();
      showToast('Category updated.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    try {
      await apiFetch('/admin/menu-categories', {
        method: 'POST',
        auth: true,
        body: {
          name: newCategoryName.trim(),
          sort_order: categories.length,
          ...(newCategoryParent ? { parent_id: newCategoryParent } : {}),
        },
      });
      setNewCategoryName('');
      load();
      showToast('Category added.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function confirmDeleteCategory() {
    if (!deleteCategoryTarget) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/admin/menu-categories/${deleteCategoryTarget.id}`, { method: 'DELETE', auth: true });
      setDeleteCategoryTarget(null);
      load();
      showToast('Category deleted.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setDeleteBusy(false);
    }
  }

  async function addItem() {
    if (!newItem.name.trim() || !newItem.category_id || !newItem.price) return;
    try {
      await apiFetch('/admin/menu-items', {
        method: 'POST',
        auth: true,
        body: {
          category_id: newItem.category_id,
          name: newItem.name.trim(),
          description: newItem.description.trim() || undefined,
          price: Number(newItem.price),
          destination: newItem.destination,
          is_available: true,
        },
      });
      setNewItem({ category_id: newItem.category_id, name: '', description: '', price: '', destination: newItem.destination });
      load();
      showToast('Menu item added.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function toggleAvailability(item: MenuItem) {
    try {
      await apiFetch(`/admin/menu-items/${item.id}`, {
        method: 'PATCH',
        auth: true,
        body: { is_available: !item.is_available },
      });
      load();
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function saveEdit() {
    if (!editingItem) return;
    setSaving(true);
    try {
      await apiFetch(`/admin/menu-items/${editingItem.id}`, {
        method: 'PATCH',
        auth: true,
        body: {
          category_id: editingItem.category_id,
          name: editingItem.name,
          description: editingItem.description ?? undefined,
          price: Number(editingItem.price),
          destination: editingItem.destination,
        },
      });
      setEditingItem(null);
      load();
      showToast('Menu item updated.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setSaving(false);
    }
  }

  async function confirmDeleteItem() {
    if (!deleteItemTarget) return;
    setDeleteBusy(true);
    try {
      await apiFetch(`/admin/menu-items/${deleteItemTarget.id}`, { method: 'DELETE', auth: true });
      setDeleteItemTarget(null);
      load();
      showToast('Menu item deleted.', 'success');
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Something went wrong.');
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div>
      {loadError && <div className="error-banner">{loadError}</div>}

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Add category</h3>
        <div className="grid-2">
          <div>
            <label>Name</label>
            <input placeholder="e.g. Desserts" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
          </div>
          <div>
            <label>Inside</label>
            {/* Only main categories are offered: menus are two levels
                deep, so a sub-category cannot hold another. */}
            <select value={newCategoryParent} onChange={(e) => setNewCategoryParent(e.target.value)}>
              <option value="">Top level (a main category)</option>
              {mains.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="secondary" onClick={addCategory}>
          Add category
        </button>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Add menu item</h3>
        <label>Category</label>
        <select value={newItem.category_id} onChange={(e) => setNewItem({ ...newItem, category_id: e.target.value })}>
          <option value="">Select a category…</option>
          {categoryOptions.map((c) => (
            <option key={c.id} value={c.id}>
              {categoryPath(c)}
            </option>
          ))}
        </select>
        <label>Name</label>
        <input value={newItem.name} onChange={(e) => setNewItem({ ...newItem, name: e.target.value })} />
        <label>Description (optional)</label>
        <input value={newItem.description} onChange={(e) => setNewItem({ ...newItem, description: e.target.value })} />
        <div className="grid-2">
          <div>
            <label>Price (KSh)</label>
            <input type="number" min="0" value={newItem.price} onChange={(e) => setNewItem({ ...newItem, price: e.target.value })} />
          </div>
          <div>
            <label>Destination</label>
            <select
              value={newItem.destination}
              onChange={(e) => setNewItem({ ...newItem, destination: e.target.value as Destination })}
            >
              {DESTINATION_OPTIONS}
            </select>
          </div>
        </div>
        <button className="primary" onClick={addItem}>
          Add item
        </button>
      </div>

      <div className="card">
        <div className="top-bar" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>Menu</h3>
          <span className="sub">
            {items.length} item{items.length === 1 ? '' : 's'} in {categories.length} categories
          </span>
        </div>
        {items.length > 20 && (
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter items…"
            aria-label="Filter menu items"
          />
        )}
      </div>

      {/* Rendered as the tree the customer sees, so what an admin edits
          looks like what a diner browses. A filter flattens it, because
          when you are hunting one item the grouping is in the way. */}
      {mains.map((main) => {
        const groups = [main, ...subsOf(main.id)];
        const visible = groups
          .map((c) => ({
            category: c,
            items: items.filter(
              (i) =>
                i.category_id === c.id &&
                (!filterQuery || i.name.toLowerCase().includes(filterQuery)),
            ),
          }))
          // While filtering, a group with no match is noise.
          .filter((g) => !filterQuery || g.items.length > 0);
        if (filterQuery && visible.length === 0) return null;

        return (
          <div key={main.id} className="menu-admin-main">
            <div className="top-bar">
              <h3>{main.name}</h3>
              <RowMenu
                label={`Actions for ${main.name}`}
                actions={[
                  {
                    label: 'Rename or move',
                    icon: <PencilIcon size={16} />,
                    onSelect: () => setEditingCategory(main),
                  },
                  {
                    label: 'Delete category',
                    icon: <TrashIcon size={16} />,
                    danger: true,
                    onSelect: () => setDeleteCategoryTarget(main),
                  },
                ]}
              />
            </div>

            {visible.map(({ category, items: categoryItems }) => (
              <div key={category.id} className={category.id === main.id ? '' : 'menu-admin-sub'}>
                {category.id !== main.id && (
                  <div className="top-bar">
                    <div className="category-title">{category.name}</div>
                    <RowMenu
                      label={`Actions for ${category.name}`}
                      actions={[
                        {
                          label: 'Rename or move',
                          icon: <PencilIcon size={16} />,
                          onSelect: () => setEditingCategory(category),
                        },
                        {
                          label: 'Delete category',
                          icon: <TrashIcon size={16} />,
                          danger: true,
                          onSelect: () => setDeleteCategoryTarget(category),
                        },
                      ]}
                    />
                  </div>
                )}
                {categoryItems.length === 0 && !filterQuery && (
                  <div className="empty-state">No items yet.</div>
                )}
                {categoryItems.map((item) => (
                  <div key={item.id} className={`card item-row ${item.is_available ? '' : 'unavailable'}`}>
                    <div>
                      <div className="item-name">{item.name}</div>
                      {item.description && <div className="item-desc">{item.description}</div>}
                      <div className="item-price">
                        KSh {Number(item.price).toLocaleString()} &middot; {item.destination}
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <button
                        className={`availability-toggle ${item.is_available ? 'available' : ''}`}
                        onClick={() => toggleAvailability(item)}
                      >
                        <span className="status-pill" style={{ background: 'transparent', padding: 0 }}>
                          {item.is_available ? 'Available' : 'Unavailable'}
                        </span>
                      </button>
                      <RowMenu
                        label={`Actions for ${item.name}`}
                        actions={[
                          { label: 'Edit', icon: <PencilIcon size={16} />, onSelect: () => setEditingItem(item) },
                          {
                            label: 'Delete',
                            icon: <TrashIcon size={16} />,
                            danger: true,
                            onSelect: () => setDeleteItemTarget(item),
                          },
                        ]}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        );
      })}

      <Dialog
        open={!!editingCategory}
        onClose={() => setEditingCategory(null)}
        title={`Edit ${editingCategory?.name ?? ''}`}
        footer={
          <>
            <button className="secondary" onClick={() => setEditingCategory(null)}>
              Cancel
            </button>
            <button className="primary" disabled={saving} onClick={saveCategory}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      >
        {editingCategory && (
          <div>
            <label>Name</label>
            <input
              value={editingCategory.name}
              onChange={(e) => setEditingCategory({ ...editingCategory, name: e.target.value })}
            />
            <label>Inside</label>
            <select
              value={editingCategory.parent_id ?? ''}
              onChange={(e) =>
                setEditingCategory({ ...editingCategory, parent_id: e.target.value || null })
              }
            >
              <option value="">Top level (a main category)</option>
              {/* A category cannot be its own parent, and the server
                  refuses depth beyond two anyway. */}
              {mains
                .filter((c) => c.id !== editingCategory.id)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
            </select>
          </div>
        )}
      </Dialog>

      <Dialog
        open={!!editingItem}
        onClose={() => setEditingItem(null)}
        title={`Edit ${editingItem?.name ?? ''}`}
        footer={
          <>
            <button className="secondary" onClick={() => setEditingItem(null)}>
              Cancel
            </button>
            <button className="primary" disabled={saving} onClick={saveEdit}>
              {saving ? 'Saving…' : 'Save changes'}
            </button>
          </>
        }
      >
        {editingItem && (
          <div>
            {/* Without this there was no way to move an item between
                categories at all -- it had to be deleted and recreated. */}
            <label>Category</label>
            <select
              value={editingItem.category_id}
              onChange={(e) => setEditingItem({ ...editingItem, category_id: e.target.value })}
            >
              {categoryOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {categoryPath(c)}
                </option>
              ))}
            </select>
            <label>Name</label>
            <input value={editingItem.name} onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })} />
            <label>Description</label>
            <input
              value={editingItem.description ?? ''}
              onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
              placeholder="Description"
            />
            <div className="grid-2">
              <div>
                <label>Price (KSh)</label>
                <input
                  type="number"
                  value={editingItem.price}
                  onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value })}
                />
              </div>
              <div>
                <label>Destination</label>
                <select
                  value={editingItem.destination}
                  onChange={(e) => setEditingItem({ ...editingItem, destination: e.target.value as Destination })}
                >
                  {DESTINATION_OPTIONS}
                </select>
              </div>
            </div>
          </div>
        )}
      </Dialog>

      <ConfirmDialog
        open={!!deleteCategoryTarget}
        title="Delete category"
        message={`Delete "${deleteCategoryTarget?.name}"? Items in it will need a new category first.`}
        confirmLabel="Delete"
        busy={deleteBusy}
        onConfirm={confirmDeleteCategory}
        onCancel={() => setDeleteCategoryTarget(null)}
      />

      <ConfirmDialog
        open={!!deleteItemTarget}
        title="Delete menu item"
        message={`Delete "${deleteItemTarget?.name}"? This can't be undone.`}
        confirmLabel="Delete"
        busy={deleteBusy}
        onConfirm={confirmDeleteItem}
        onCancel={() => setDeleteItemTarget(null)}
      />
    </div>
  );
}
