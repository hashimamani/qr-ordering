import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { MenuCategory, MenuItem, Destination } from '../../api/types';
import { Dialog } from '../../components/Dialog';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { RowMenu } from '../../components/RowMenu';
import { useToast } from '../../components/ToastProvider';
import { PencilIcon, TrashIcon } from '../../components/icons';

export function AdminMenuTab() {
  const showToast = useToast();
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loadError, setLoadError] = useState('');

  const [newCategoryName, setNewCategoryName] = useState('');
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

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    try {
      await apiFetch('/admin/menu-categories', {
        method: 'POST',
        auth: true,
        body: { name: newCategoryName.trim(), sort_order: categories.length },
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
          <input placeholder="e.g. Desserts" value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} />
          <button className="secondary" onClick={addCategory}>
            Add category
          </button>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginTop: 0 }}>Add menu item</h3>
        <label>Category</label>
        <select value={newItem.category_id} onChange={(e) => setNewItem({ ...newItem, category_id: e.target.value })}>
          <option value="">Select a category…</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
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
              <option value="kitchen">Kitchen</option>
              <option value="bar">Bar</option>
            </select>
          </div>
        </div>
        <button className="primary" onClick={addItem}>
          Add item
        </button>
      </div>

      {categories.map((category) => {
        const categoryItems = items.filter((i) => i.category_id === category.id);
        return (
          <div key={category.id} className="table-block">
            <div className="top-bar">
              <h3>{category.name}</h3>
              <RowMenu
                label={`Actions for ${category.name}`}
                actions={[
                  {
                    label: 'Delete category',
                    icon: <TrashIcon size={16} />,
                    danger: true,
                    onSelect: () => setDeleteCategoryTarget(category),
                  },
                ]}
              />
            </div>
            {categoryItems.length === 0 && <div className="empty-state">No items yet.</div>}
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
        );
      })}

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
                  <option value="kitchen">Kitchen</option>
                  <option value="bar">Bar</option>
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
