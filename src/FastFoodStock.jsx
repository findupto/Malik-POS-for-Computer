import React, { useEffect, useMemo, useState } from 'react';
import { Boxes, BookOpen, ClipboardList, Plus, Search, ShoppingCart, Trash2, TrendingDown, TrendingUp, Utensils, X } from 'lucide-react';

const readStock = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem('malik-stock-' + key)) ?? fallback; } catch { return fallback; }
};
const moneyStock = n => 'Rs. ' + new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const units = ['g', 'ml', 'each'];
const tabs = [
  { id: 'ingredients', label: 'Ingredients & stock', icon: Boxes },
  { id: 'recipes', label: 'Recipes & portions', icon: BookOpen },
  { id: 'purchases', label: 'Purchases', icon: ShoppingCart },
  { id: 'reports', label: 'Stock reports', icon: ClipboardList }
];

export function consumeRecipeIngredients(items, orderId) {
  try {
    const ingredients = JSON.parse(localStorage.getItem('malik-stock-ingredients') || '[]');
    const recipes = JSON.parse(localStorage.getItem('malik-stock-recipes') || '[]');
    const movements = JSON.parse(localStorage.getItem('malik-stock-movements') || '[]');
    const next = ingredients.map(x => ({ ...x }));
    const newMovements = [];
    for (const sold of items || []) {
      const recipe = recipes.find(r => String(r.productId || '') === String(sold.id) && (!r.variant || r.variant === (sold.variant || '')))
        || recipes.find(r => r.productName?.trim().toLowerCase() === String(sold.name || '').trim().toLowerCase() && (!r.variant || r.variant === (sold.variant || '')));
      if (!recipe) continue;
      for (const line of recipe.ingredients || []) {
        const ingredient = next.find(x => String(x.id) === String(line.ingredientId));
        if (!ingredient) continue;
        const amount = Math.max(0, Number(line.qty) || 0) * Math.max(0, Number(sold.qty) || 0);
        ingredient.stock = Number(ingredient.stock || 0) - amount;
        newMovements.push({ id: Date.now() + Math.random(), date: new Date().toISOString(), ingredientId: ingredient.id, ingredientName: ingredient.name, type: 'sale', qty: -amount, unit: ingredient.unit, reference: orderId || 'Sale', note: (sold.name || recipe.productName) + ' × ' + sold.qty });
      }
    }
    if (newMovements.length) {
      localStorage.setItem('malik-stock-ingredients', JSON.stringify(next));
      localStorage.setItem('malik-stock-movements', JSON.stringify([...newMovements, ...movements]));
      window.dispatchEvent(new CustomEvent('malik-stock-updated'));
    }
    return newMovements.length;
  } catch { return 0; }
}

export function adjustRecipeIngredients(oldItems, nextItems, orderId) {
  try {
    const ingredients = JSON.parse(localStorage.getItem('malik-stock-ingredients') || '[]');
    const recipes = JSON.parse(localStorage.getItem('malik-stock-recipes') || '[]');
    const movements = JSON.parse(localStorage.getItem('malik-stock-movements') || '[]');
    const key = item => String(item.id || item.name) + '::' + String(item.variant || '');
    const before = new Map((oldItems || []).map(x => [key(x), x]));
    const after = new Map((nextItems || []).map(x => [key(x), x]));
    const keys = new Set([...before.keys(), ...after.keys()]);
    const next = ingredients.map(x => ({ ...x }));
    const added = [];
    for (const k of keys) {
      const oldItem = before.get(k), newItem = after.get(k), item = newItem || oldItem;
      const delta = Number(newItem?.qty || 0) - Number(oldItem?.qty || 0);
      if (!delta) continue;
      const recipe = recipes.find(r => String(r.productId || '') === String(item.id) && (!r.variant || r.variant === (item.variant || '')))
        || recipes.find(r => r.productName?.trim().toLowerCase() === String(item.name || '').trim().toLowerCase() && (!r.variant || r.variant === (item.variant || '')));
      if (!recipe) continue;
      for (const line of recipe.ingredients || []) {
        const ingredient = next.find(x => String(x.id) === String(line.ingredientId));
        if (!ingredient) continue;
        const change = (Number(line.qty) || 0) * delta;
        ingredient.stock = Number(ingredient.stock || 0) - change;
        added.push({ id: Date.now() + Math.random(), date: new Date().toISOString(), ingredientId: ingredient.id, ingredientName: ingredient.name, type: change > 0 ? 'sale amendment' : 'amendment reversal', qty: -change, unit: ingredient.unit, reference: orderId || 'Order amendment', note: (item.name || recipe.productName) + ' quantity adjustment: ' + delta });
      }
    }
    if (added.length) {
      localStorage.setItem('malik-stock-ingredients', JSON.stringify(next));
      localStorage.setItem('malik-stock-movements', JSON.stringify([...added, ...movements]));
      window.dispatchEvent(new CustomEvent('malik-stock-updated'));
    }
    return added.length;
  } catch { return 0; }
}

export default function FastFoodStock({ notify }) {
  const [tab, setTab] = useState('ingredients');
  const [ingredients, setIngredients] = useState(() => readStock('ingredients', []));
  const [recipes, setRecipes] = useState(() => readStock('recipes', []));
  const [purchases, setPurchases] = useState(() => readStock('purchases', []));
  const [movements, setMovements] = useState(() => readStock('movements', []));
  const [menuProducts, setMenuProducts] = useState(() => { try { return JSON.parse(localStorage.getItem('malik-products') || '[]'); } catch { return []; } });
  const [search, setSearch] = useState('');
  const [showIngredient, setShowIngredient] = useState(false);
  const [showRecipe, setShowRecipe] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const [ingredientDraft, setIngredientDraft] = useState({ name: '', sku: '', category: 'Food', unit: 'g', stock: '0', reorder: '0', cost: '0', supplier: '' });
  const [recipeDraft, setRecipeDraft] = useState({ productId: '', productName: '', variant: '', ingredients: [] });
  const [recipeLine, setRecipeLine] = useState({ ingredientId: '', qty: '' });
  const [purchaseDraft, setPurchaseDraft] = useState({ supplier: '', invoice: '', ingredientId: '', purchaseQty: '', conversion: '1', unitCost: '', paid: '', notes: '' });

  const save = (key, value) => localStorage.setItem('malik-stock-' + key, JSON.stringify(value));
  useEffect(() => {
    const refresh = () => {
      setIngredients(readStock('ingredients', [])); setRecipes(readStock('recipes', []));
      setPurchases(readStock('purchases', [])); setMovements(readStock('movements', []));
      try { setMenuProducts(JSON.parse(localStorage.getItem('malik-products') || '[]')); } catch {}
    };
    window.addEventListener('malik-stock-updated', refresh);
    return () => window.removeEventListener('malik-stock-updated', refresh);
  }, []);
  const lowStock = ingredients.filter(x => Number(x.stock) <= Number(x.reorder));
  const filteredIngredients = useMemo(() => ingredients.filter(x => (x.name + ' ' + x.sku + ' ' + x.category).toLowerCase().includes(search.toLowerCase())), [ingredients, search]);
  const ingredientValue = ingredients.reduce((n, x) => n + Number(x.stock || 0) * Number(x.cost || 0), 0);
  const missingRecipes = menuProducts.filter(p => !recipes.some(r => String(r.productId || '') === String(p.id) || r.productName?.trim().toLowerCase() === String(p.name || '').trim().toLowerCase()));

  function saveIngredient(e) {
    e.preventDefault();
    if (!ingredientDraft.name.trim() || Number(ingredientDraft.stock) < 0 || Number(ingredientDraft.cost) < 0) { notify('Enter a name and valid stock/cost'); return; }
    const item = { ...ingredientDraft, id: Date.now(), name: ingredientDraft.name.trim(), stock: Number(ingredientDraft.stock) || 0, reorder: Number(ingredientDraft.reorder) || 0, cost: Number(ingredientDraft.cost) || 0 };
    const next = [item, ...ingredients]; setIngredients(next); save('ingredients', next);
    setIngredientDraft({ name: '', sku: '', category: 'Food', unit: 'g', stock: '0', reorder: '0', cost: '0', supplier: '' }); setShowIngredient(false);
    setMovements(old => { const m = [{ id: Date.now() + 1, date: new Date().toISOString(), ingredientId: item.id, ingredientName: item.name, type: 'opening', qty: item.stock, unit: item.unit, reference: 'Opening balance', note: 'Opening stock' }, ...old]; save('movements', m); return m; });
    notify('Ingredient added');
  }
  function saveRecipe(e) {
    e.preventDefault();
    if (!recipeDraft.productName.trim() || !recipeDraft.ingredients.length) { notify('Choose a menu item and add at least one ingredient'); return; }
    const recipe = { ...recipeDraft, id: Date.now(), productId: recipeDraft.productId || '', ingredients: recipeDraft.ingredients.map(x => ({ ...x, qty: Number(x.qty) || 0 })) };
    const next = [recipe, ...recipes.filter(r => !(String(r.productId || '') === String(recipe.productId) && r.variant === recipe.variant) && !(r.productName.toLowerCase() === recipe.productName.toLowerCase() && r.variant === recipe.variant))];
    setRecipes(next); save('recipes', next); setRecipeDraft({ productId: '', productName: '', variant: '', ingredients: [] }); setShowRecipe(false); notify('Recipe saved');
  }
  function addRecipeLine() {
    if (!recipeLine.ingredientId || Number(recipeLine.qty) <= 0) { notify('Choose an ingredient and enter a positive quantity'); return; }
    const item = ingredients.find(x => String(x.id) === String(recipeLine.ingredientId));
    if (!item) return;
    setRecipeDraft(old => ({ ...old, ingredients: [...old.ingredients, { ingredientId: item.id, ingredientName: item.name, qty: Number(recipeLine.qty), unit: item.unit }] }));
    setRecipeLine({ ingredientId: '', qty: '' });
  }
  function savePurchase(e) {
    e.preventDefault();
    const ingredient = ingredients.find(x => String(x.id) === String(purchaseDraft.ingredientId));
    const qty = Number(purchaseDraft.purchaseQty), conversion = Number(purchaseDraft.conversion), unitCost = Number(purchaseDraft.unitCost);
    if (!ingredient || qty <= 0 || conversion <= 0 || unitCost < 0 || !purchaseDraft.supplier.trim()) { notify('Enter supplier, ingredient, quantity, conversion and cost'); return; }
    const baseQty = qty * conversion, total = qty * unitCost;
    const nextIngredients = ingredients.map(x => String(x.id) === String(ingredient.id) ? { ...x, stock: Number(x.stock || 0) + baseQty, cost: total / baseQty, supplier: purchaseDraft.supplier.trim() } : x);
    const purchase = { id: 'PUR-' + Date.now().toString().slice(-7), date: new Date().toISOString(), supplier: purchaseDraft.supplier.trim(), invoice: purchaseDraft.invoice, ingredientId: ingredient.id, ingredientName: ingredient.name, purchaseQty: qty, purchaseUnit: purchaseDraft.purchaseUnit || ingredient.unit, conversion, baseQty, unit: ingredient.unit, unitCost, total, paid: Math.min(total, Math.max(0, Number(purchaseDraft.paid) || 0)), notes: purchaseDraft.notes };
    const nextPurchases = [purchase, ...purchases];
    const movement = { id: Date.now(), date: purchase.date, ingredientId: ingredient.id, ingredientName: ingredient.name, type: 'purchase', qty: baseQty, unit: ingredient.unit, reference: purchase.id, note: purchaseDraft.supplier + (purchaseDraft.invoice ? ' · Invoice ' + purchaseDraft.invoice : '') };
    setIngredients(nextIngredients); save('ingredients', nextIngredients); setPurchases(nextPurchases); save('purchases', nextPurchases);
    const nextMovements = [movement, ...movements]; setMovements(nextMovements); save('movements', nextMovements);
    setPurchaseDraft({ supplier: '', invoice: '', ingredientId: '', purchaseQty: '', conversion: '1', unitCost: '', paid: '', notes: '' }); setShowPurchase(false); notify('Purchase recorded and stock increased');
  }
  function removeIngredient(id) {
    if (recipes.some(r => r.ingredients.some(x => String(x.ingredientId) === String(id)))) { notify('Remove this ingredient from its recipes first'); return; }
    const next = ingredients.filter(x => x.id !== id); setIngredients(next); save('ingredients', next); notify('Ingredient removed');
  }
  function removeRecipe(id) { const next = recipes.filter(x => x.id !== id); setRecipes(next); save('recipes', next); notify('Recipe removed'); }
  function exportStock() {
    const rows = [['Ingredient','SKU','Category','On hand','Base unit','Reorder level','Cost per base unit','Stock value'], ...ingredients.map(x => [x.name,x.sku,x.category,x.stock,x.unit,x.reorder,x.cost,Number(x.stock||0)*Number(x.cost||0)])];
    const csv = rows.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"','""') + '"').join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'malik-pos-ingredient-stock.csv'; a.click(); URL.revokeObjectURL(a.href);
  }
  const recipeCost = recipe => (recipe.ingredients || []).reduce((n, line) => { const item = ingredients.find(x => String(x.id) === String(line.ingredientId)); return n + Number(line.qty || 0) * Number(item?.cost || 0); }, 0);

  return <div className="ff-stock">
    <div className="ff-stock-summary">
      <div className="ff-stock-stat"><span>Ingredient items</span><b>{ingredients.length}</b><small>Shared across all recipes</small></div>
      <div className="ff-stock-stat"><span>Estimated stock value</span><b>{moneyStock(ingredientValue)}</b><small>On-hand quantity × latest unit cost</small></div>
      <div className={'ff-stock-stat ' + (lowStock.length ? 'is-warning' : '')}><span>Low / reorder items</span><b>{lowStock.length}</b><small>At or below reorder level</small></div>
      <div className={'ff-stock-stat ' + (missingRecipes.length ? 'is-warning' : '')}><span>Menu items without recipes</span><b>{missingRecipes.length}</b><small>Sales won't consume ingredients until configured</small></div>
    </div>
    <div className="ff-stock-tabs">{tabs.map(t => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><t.icon size={16}/>{t.label}</button>)}</div>
    {tab === 'ingredients' && <div className="panel table-panel">
      <div className="table-toolbar"><div className="search-box"><Search size={16}/><input placeholder="Search ingredient, SKU or category" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="toolbar-right"><button className="btn btn-secondary" onClick={exportStock}>Export stock</button><button className="btn btn-primary" onClick={() => setShowIngredient(true)}><Plus size={16}/> Add ingredient</button></div></div>
      <div className="responsive-table"><table><thead><tr><th>INGREDIENT</th><th>CATEGORY</th><th>ON HAND</th><th>UNIT COST</th><th>STOCK VALUE</th><th>REORDER AT</th><th>STATUS</th><th></th></tr></thead><tbody>{filteredIngredients.map(x => <tr key={x.id}><td><b>{x.name}</b><div className="ff-muted">{x.sku || 'No SKU'} · {x.supplier || 'No supplier set'}</div></td><td>{x.category}</td><td><b>{Number(x.stock).toLocaleString()} {x.unit}</b></td><td>{moneyStock(x.cost)}</td><td>{moneyStock(Number(x.stock) * Number(x.cost))}</td><td>{x.reorder} {x.unit}</td><td><span className={'status-pill ' + (Number(x.stock) <= 0 ? 'status-out' : Number(x.stock) <= Number(x.reorder) ? 'status-low' : 'status-good')}>{Number(x.stock) <= 0 ? 'Out of stock' : Number(x.stock) <= Number(x.reorder) ? 'Reorder' : 'In stock'}</span></td><td><button className="icon-btn" title="Remove ingredient" onClick={() => removeIngredient(x.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table>{!filteredIngredients.length && <div className="empty-state"><Boxes size={28}/><b>No ingredients yet</b><span>Add bread, chicken, beef, milk, ice cream, sauces, cups and packaging as shared stock items.</span></div>}</div>
    </div>}
    {tab === 'recipes' && <div className="panel table-panel">
      <div className="table-toolbar"><div><b>Recipe & portion cards</b><div className="ff-muted">Quantities are consumed in each ingredient's base unit per one menu item.</div></div><button className="btn btn-primary" onClick={() => setShowRecipe(true)}><Plus size={16}/> Build recipe</button></div>
      <div className="responsive-table"><table><thead><tr><th>MENU ITEM</th><th>VARIANT</th><th>INGREDIENTS</th><th>EST. FOOD COST</th><th></th></tr></thead><tbody>{recipes.map(r => <tr key={r.id}><td><b>{r.productName}</b></td><td>{r.variant || 'Default / all variants'}</td><td><div className="ff-recipe-lines">{r.ingredients.map((line,i) => <span key={i}>{line.ingredientName}: {line.qty} {line.unit}</span>)}</div></td><td><b>{moneyStock(recipeCost(r))}</b></td><td><button className="icon-btn" title="Remove recipe" onClick={() => removeRecipe(r.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table>{!recipes.length && <div className="empty-state"><BookOpen size={28}/><b>No recipes configured</b><span>Create recipes for menu items and their portion sizes. Different variants can share the same ingredient.</span></div>}</div>
      {missingRecipes.length > 0 && <div className="ff-alert"><Utensils size={17}/><div><b>{missingRecipes.length} menu items need recipe setup</b><p>Unconfigured items will still sell, but will not deduct ingredient stock. Start with your best-selling items.</p></div></div>}
    </div>}
    {tab === 'purchases' && <div className="panel table-panel">
      <div className="table-toolbar"><div><b>Supplier purchases</b><div className="ff-muted">Convert cartons, bags, bottles or packs into base units on receipt.</div></div><button className="btn btn-primary" onClick={() => setShowPurchase(true)}><Plus size={16}/> Record purchase</button></div>
      <div className="responsive-table"><table><thead><tr><th>DATE / REF</th><th>SUPPLIER</th><th>INGREDIENT</th><th>QUANTITY RECEIVED</th><th>TOTAL</th><th>PAID</th><th>DUE</th></tr></thead><tbody>{purchases.map(p => <tr key={p.id}><td><b>{p.id}</b><div className="ff-muted">{new Date(p.date).toLocaleDateString()}</div></td><td>{p.supplier}<div className="ff-muted">{p.invoice || ''}</div></td><td>{p.ingredientName}</td><td>{p.purchaseQty} × {p.conversion} {p.unit} = {p.baseQty} {p.unit}</td><td>{moneyStock(p.total)}</td><td>{moneyStock(p.paid)}</td><td><b>{moneyStock(Math.max(0,p.total-p.paid))}</b></td></tr>)}</tbody></table>{!purchases.length && <div className="empty-state"><ShoppingCart size={28}/><b>No purchases recorded</b><span>Record each supplier delivery to increase ingredient stock and track unpaid balances.</span></div>}</div>
    </div>}
    {tab === 'reports' && <div className="panel table-panel">
      <div className="panel-head"><div><h2>Stock movement report</h2><p>Opening balances, purchases and recipe consumption</p></div><button className="btn btn-secondary" onClick={exportStock}>Export CSV</button></div>
      <div className="responsive-table"><table><thead><tr><th>DATE</th><th>INGREDIENT</th><th>MOVEMENT</th><th>QUANTITY</th><th>REFERENCE</th><th>NOTES</th></tr></thead><tbody>{movements.map(m => <tr key={m.id}><td>{new Date(m.date).toLocaleString()}</td><td><b>{m.ingredientName}</b></td><td>{m.type}</td><td className={m.qty < 0 ? 'ff-negative' : 'ff-positive'}>{m.qty > 0 ? '+' : ''}{m.qty} {m.unit}</td><td>{m.reference}</td><td>{m.note}</td></tr>)}</tbody></table>{!movements.length && <div className="empty-state"><TrendingUp size={28}/><b>No stock movements yet</b><span>Purchases and configured recipe sales will appear here.</span></div>}</div>
      <div className="ff-report-shortcuts">{['Low stock', 'Uncosted recipes', 'Supplier dues'].map(label => <button key={label} onClick={() => { if(label === 'Low stock') { setTab('ingredients'); setSearch(''); } else if(label === 'Uncosted recipes') setTab('recipes'); else setTab('purchases'); }}>{label} <TrendingDown size={15}/></button>)}</div>
    </div>}
    {showIngredient && <div className="modal-backdrop"><form className="modal" onSubmit={saveIngredient}><div className="modal-heading"><div><h2>Add ingredient</h2><p>Use one consistent base unit for every recipe.</p></div><button type="button" className="icon-btn" onClick={() => setShowIngredient(false)}><X size={16}/></button></div><label className="field-label">INGREDIENT NAME</label><input className="form-input" required autoFocus value={ingredientDraft.name} onChange={e => setIngredientDraft({...ingredientDraft,name:e.target.value})} placeholder="Chicken breast, burger bun, vanilla ice cream"/><div className="form-two"><div><label className="field-label">SKU / CODE</label><input className="form-input" value={ingredientDraft.sku} onChange={e => setIngredientDraft({...ingredientDraft,sku:e.target.value})}/></div><div><label className="field-label">CATEGORY</label><select className="form-input" value={ingredientDraft.category} onChange={e => setIngredientDraft({...ingredientDraft,category:e.target.value})}>{['Food','Meat','Dairy','Bakery','Sauce','Packaging','Beverage','Other'].map(x=><option key={x}>{x}</option>)}</select></div></div><div className="form-two"><div><label className="field-label">BASE UNIT</label><select className="form-input" value={ingredientDraft.unit} onChange={e => setIngredientDraft({...ingredientDraft,unit:e.target.value})}>{units.map(x=><option key={x}>{x}</option>)}</select></div><div><label className="field-label">OPENING STOCK ({ingredientDraft.unit})</label><input className="form-input" type="number" min="0" step="any" required value={ingredientDraft.stock} onChange={e => setIngredientDraft({...ingredientDraft,stock:e.target.value})}/></div></div><div className="form-two"><div><label className="field-label">COST PER BASE UNIT (Rs.)</label><input className="form-input" type="number" min="0" step="any" required value={ingredientDraft.cost} onChange={e => setIngredientDraft({...ingredientDraft,cost:e.target.value})}/></div><div><label className="field-label">REORDER LEVEL ({ingredientDraft.unit})</label><input className="form-input" type="number" min="0" step="any" value={ingredientDraft.reorder} onChange={e => setIngredientDraft({...ingredientDraft,reorder:e.target.value})}/></div></div><label className="field-label">PREFERRED SUPPLIER (OPTIONAL)</label><input className="form-input" value={ingredientDraft.supplier} onChange={e => setIngredientDraft({...ingredientDraft,supplier:e.target.value})}/><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowIngredient(false)}>Cancel</button><button className="btn btn-primary" type="submit">Save ingredient</button></div></form></div>}
    {showRecipe && <div className="modal-backdrop"><form className="modal ff-wide-modal" onSubmit={saveRecipe}><div className="modal-heading"><div><h2>Recipe & portion setup</h2><p>Ingredient quantities are per one sold menu item.</p></div><button type="button" className="icon-btn" onClick={() => setShowRecipe(false)}><X size={16}/></button></div><label className="field-label">MENU ITEM</label><select className="form-input" required value={recipeDraft.productId} onChange={e => { const p = menuProducts.find(x => String(x.id) === e.target.value); setRecipeDraft(old => ({...old,productId:e.target.value,productName:p?.name || old.productName,variant:p?.variant || ''})); }}><option value="">Select existing POS item</option>{menuProducts.map(p => <option key={p.id} value={p.id}>{p.name}{p.variant ? ' · ' + p.variant : ''}</option>)}</select>{!menuProducts.length && <div className="ff-alert">Add menu items in the POS catalog first.</div>}<label className="field-label">VARIANT / PORTION (OPTIONAL)</label><input className="form-input" value={recipeDraft.variant} onChange={e => setRecipeDraft({...recipeDraft,variant:e.target.value})} placeholder="Small, Large, 1 scoop, 2 scoops — leave blank for all variants"/><div className="form-two"><div><label className="field-label">INGREDIENT</label><select className="form-input" value={recipeLine.ingredientId} onChange={e => setRecipeLine({...recipeLine,ingredientId:e.target.value})}><option value="">Select ingredient</option>{ingredients.map(x => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div><div><label className="field-label">QUANTITY PER ITEM ({ingredients.find(x => String(x.id) === String(recipeLine.ingredientId))?.unit || 'unit'})</label><input className="form-input" type="number" min="0.001" step="any" value={recipeLine.qty} onChange={e => setRecipeLine({...recipeLine,qty:e.target.value})} placeholder="e.g. 80 for 80g scoop"/></div></div><button type="button" className="btn btn-secondary" onClick={addRecipeLine}><Plus size={15}/> Add ingredient to recipe</button><div className="ff-recipe-editor">{recipeDraft.ingredients.map((x,i) => <div key={i}><span>{x.ingredientName}</span><b>{x.qty} {x.unit}</b><button type="button" className="icon-btn" onClick={() => setRecipeDraft(old => ({...old,ingredients:old.ingredients.filter((_,j) => j !== i)}))}><Trash2 size={13}/></button></div>)}</div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowRecipe(false)}>Cancel</button><button className="btn btn-primary" type="submit">Save recipe</button></div></form></div>}
    {showPurchase && <div className="modal-backdrop"><form className="modal ff-wide-modal" onSubmit={savePurchase}><div className="modal-heading"><div><h2>Record ingredient purchase</h2><p>Convert supplier packaging into your stock base unit.</p></div><button type="button" className="icon-btn" onClick={() => setShowPurchase(false)}><X size={16}/></button></div><label className="field-label">SUPPLIER</label><input className="form-input" required value={purchaseDraft.supplier} onChange={e => setPurchaseDraft({...purchaseDraft,supplier:e.target.value})} placeholder="Supplier / vendor name"/><div className="form-two"><div><label className="field-label">INVOICE / BILL NUMBER</label><input className="form-input" value={purchaseDraft.invoice} onChange={e => setPurchaseDraft({...purchaseDraft,invoice:e.target.value})}/></div><div><label className="field-label">INGREDIENT</label><select className="form-input" required value={purchaseDraft.ingredientId} onChange={e => setPurchaseDraft({...purchaseDraft,ingredientId:e.target.value})}><option value="">Select ingredient</option>{ingredients.map(x => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div></div><div className="form-two"><div><label className="field-label">PURCHASE QUANTITY (PACKS)</label><input className="form-input" type="number" min="0.001" step="any" required value={purchaseDraft.purchaseQty} onChange={e => setPurchaseDraft({...purchaseDraft,purchaseQty:e.target.value})} placeholder="10 cartons"/></div><div><label className="field-label">BASE UNITS PER PACK</label><input className="form-input" type="number" min="0.001" step="any" required value={purchaseDraft.conversion} onChange={e => setPurchaseDraft({...purchaseDraft,conversion:e.target.value})} placeholder="10000 grams per 10kg carton"/></div></div><div className="form-two"><div><label className="field-label">COST PER PACK (Rs.)</label><input className="form-input" type="number" min="0" step="any" required value={purchaseDraft.unitCost} onChange={e => setPurchaseDraft({...purchaseDraft,unitCost:e.target.value})}/></div><div><label className="field-label">AMOUNT PAID (Rs.)</label><input className="form-input" type="number" min="0" step="any" value={purchaseDraft.paid} onChange={e => setPurchaseDraft({...purchaseDraft,paid:e.target.value})} placeholder="0 if on credit"/></div></div><label className="field-label">NOTES</label><input className="form-input" value={purchaseDraft.notes} onChange={e => setPurchaseDraft({...purchaseDraft,notes:e.target.value})} placeholder="Optional delivery notes"/><div className="ff-purchase-preview">Received: <b>{((Number(purchaseDraft.purchaseQty)||0)*(Number(purchaseDraft.conversion)||0)).toLocaleString()} {ingredients.find(x => String(x.id) === String(purchaseDraft.ingredientId))?.unit || 'base units'}</b> · Total: <b>{moneyStock((Number(purchaseDraft.purchaseQty)||0)*(Number(purchaseDraft.unitCost)||0))}</b></div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowPurchase(false)}>Cancel</button><button className="btn btn-primary" type="submit">Post purchase & update stock</button></div></form></div>}
  </div>;
}
