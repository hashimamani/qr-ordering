import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '../../api/client';
import type { MenuCategory, MenuItem, Destination } from '../../api/types';

export function AdminMenuTab() {
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [error, setError] = useState('');

  const [newCategoryName, setNewCategoryName] = useState('');
  const [newItem, setNewItem] = useState({
    category_id: '',
    name: '',
    description: '',
    price: '',
    destination: 'kitchen' as Destination,
  });
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null);

  const load = useCallback(() => {
    apiFetch<{ categories: MenuCategory[]; items: MenuItem[] }>('/admin/menu', { auth: true })
      .then((data) => {
        setCategories(data.categories);
        setItems(data.items);
      })
      .catch((err: ApiError) => setError(err.message));
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function deleteCategory(id: string) {
    if (!confirm('Delete this category? Items in it will need a new category first.')) return;
    try {
      await apiFetch(`/admin/menu-categories/${id}`, { method: 'DELETE', auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
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
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function saveEdit() {
    if (!editingItem) return;
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
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  async function deleteItem(id: string) {
    if (!confirm('Delete this menu item?')) return;
    try {
      await apiFetch(`/admin/menu-items/${id}`, { method: 'DELETE', auth: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  }

  return (
    <div>
      {error && <div className="error-banner">{error}</div>}

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
              <button className="secondary danger" onClick={() => deleteCategory(category.id)}>
                Delete category
              </button>
            </div>
            {categoryItems.length === 0 && <div className="empty-state">No items yet.</div>}
            {categoryItems.map((item) =>
              editingItem?.id === item.id ? (
                <div key={item.id} className="card">
                  <input value={editingItem.name} onChange={(e) => setEditingItem({ ...editingItem, name: e.target.value })} />
                  <input
                    value={editingItem.description ?? ''}
                    onChange={(e) => setEditingItem({ ...editingItem, description: e.target.value })}
                    placeholder="Description"
                  />
                  <div className="grid-2">
                    <input
                      type="number"
                      value={editingItem.price}
                      onChange={(e) => setEditingItem({ ...editingItem, price: e.target.value })}
                    />
                    <select
                      value={editingItem.destination}
                      onChange={(e) => setEditingItem({ ...editingItem, destination: e.target.value as Destination })}
                    >
                      <option value="kitchen">Kitchen</option>
                      <option value="bar">Bar</option>
                    </select>
                  </div>
                  <div className="grid-2">
                    <button className="primary" onClick={saveEdit}>
                      Save
                    </button>
                    <button className="secondary" onClick={() => setEditingItem(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div key={item.id} className={`card item-row ${item.is_available ? '' : 'unavailable'}`}>
                  <div>
                    <div className="item-name">{item.name}</div>
                    {item.description && <div className="item-desc">{item.description}</div>}
                    <div className="item-price">
                      KSh {Number(item.price).toFixed(0)} &middot; {item.destination}
                      {!item.is_available && ' · unavailable'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="secondary" onClick={() => setEditingItem(item)}>
                      Edit
                    </button>
                    <button className="secondary" onClick={() => toggleAvailability(item)}>
                      {item.is_available ? 'Mark unavailable' : 'Mark available'}
                    </button>
                    <button className="secondary danger" onClick={() => deleteItem(item.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              ),
            )}
          </div>
        );
      })}
    </div>
  );
}
