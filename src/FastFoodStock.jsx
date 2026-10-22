import React, { useEffect, useMemo, useState } from 'react';
import { Boxes, BookOpen, ClipboardList, Plus, Search, ShoppingCart, Trash2, TrendingDown, TrendingUp, Utensils, X } from 'lucide-react';

const readStock = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem('malik-stock-' + key)) ?? fallback; } catch { return fallback; }
};
const moneyStock = n => 'Rs. ' + new Intl.NumberFormat('en-PK', { maximumFractionDigits: 2 }).format(Number(n) || 0);
const units = ['kg', 'g', 'L', 'ml', 'each'];
const unitFamilies = { kg: 'weight', g: 'weight', L: 'volume', ml: 'volume', each: 'count' };
const unitScale = { kg: 1000, g: 1, L: 1000, ml: 1, each: 1 };

const starterIngredients = [
  ['Chicken breast / boneless chicken','Meat','g'],['Beef mince / patty','Meat','g'],['Burger bun','Bakery','each'],['Pizza dough / base','Bakery','each'],['Pita / shawarma bread','Bakery','each'],['Tortilla / wrap','Bakery','each'],['Potato / fries','Food','g'],['Mozzarella cheese','Dairy','g'],['Cheddar cheese','Dairy','g'],['Mayonnaise','Sauce','g'],['Garlic mayo / toum','Sauce','g'],['Pizza sauce','Sauce','g'],['Ketchup','Sauce','g'],['BBQ sauce','Sauce','g'],['Fajita seasoning','Food','g'],['Shawarma spice mix','Food','g'],['Lettuce','Food','g'],['Tomato','Food','g'],['Onion','Food','g'],['Capsicum / bell pepper','Food','g'],['Cucumber / pickle','Food','g'],['Cooking oil','Food','ml'],['Salt','Food','g'],['Black pepper','Food','g'],['Flour / maida','Food','g'],['Milk','Dairy','ml'],['Sugar','Food','g'],['Coffee','Beverage','g'],['Tea','Beverage','g'],['Ice cream','Dairy','g'],['Chocolate syrup','Sauce','g'],['Paper box / packaging','Packaging','each']
].map((x,i)=>({id:'starter-'+(i+1),name:x[0],sku:'ING-'+String(i+1).padStart(3,'0'),category:x[1],unit:x[2],stock:0,reorder:0,cost:0,supplier:'',starter:true}));
const starterRecipeFor = (p, ingredients) => {
  const n=String(p.name||'').toLowerCase();
  const pick=(name,qty)=>{const x=ingredients.find(i=>i.name===name);return x?{ingredientId:x.id,ingredientName:x.name,qty,unit:x.unit}:null;};
  let lines=null;
  if(/pizza/.test(n)){lines=[pick('Pizza dough / base',1),pick('Pizza sauce',60),pick('Mozzarella cheese',90)];if(/chicken|fajita|shawarma|tikka/.test(n))lines.push(pick('Chicken breast / boneless chicken',75));if(/fajita|mexican/.test(n))lines.push(pick('Capsicum / bell pepper',25),pick('Onion',20),pick('Fajita seasoning',4));}
  else if(/shawarma|shwarma/.test(n)){lines=[pick('Pita / shawarma bread',1),pick('Chicken breast / boneless chicken',120),pick('Garlic mayo / toum',25),pick('Lettuce',15),pick('Tomato',20),pick('Shawarma spice mix',5)];}
  else if(/fajita/.test(n)){lines=[pick('Tortilla / wrap',1),pick('Chicken breast / boneless chicken',100),pick('Capsicum / bell pepper',25),pick('Onion',20),pick('Fajita seasoning',5),pick('Mayonnaise',15)];}
  else if(/zinger|chicken burger|burger|hamburger/.test(n)){lines=[pick('Burger bun',1),pick('Chicken breast / boneless chicken',120),pick('Mayonnaise',20),pick('Lettuce',15),pick('Tomato',20)];}
  else if(/fries|chips/.test(n)){lines=[pick('Potato / fries',200),pick('Cooking oil',20),pick('Salt',2),pick('Ketchup',20)];}
  else if(/wrap|roll|sandwich/.test(n)){lines=[pick('Tortilla / wrap',1),pick('Chicken breast / boneless chicken',90),pick('Mayonnaise',20),pick('Lettuce',10),pick('Tomato',15)];}
  else if(/nugget|wing|tender/.test(n)){lines=[pick('Chicken breast / boneless chicken',150),pick('Flour / maida',25),pick('Cooking oil',20),pick('Salt',2),pick('Black pepper',1)];}
  else if(/coffee|latte|cappuccino|mocha/.test(n)){lines=[pick('Coffee',10),pick('Milk',200),pick('Sugar',10)];}
  else if(/tea|chai/.test(n)){lines=[pick('Tea',4),pick('Milk',100),pick('Sugar',10)];}
  else if(/shake|smoothie|frappe/.test(n)){lines=[pick('Milk',200),pick('Ice cream',100),pick('Sugar',10)];}
  else return null;
  return {id:'starter-recipe-'+p.id,productId:String(p.id),productName:p.name,variant:'',ingredients:lines.filter(Boolean),starter:true,portionNote:'Starter estimate per 1 menu item — verify and edit to match your kitchen.'};
};

const tabs = [
  { id: 'ingredients', label: 'Ingredients & stock', icon: Boxes },
  { id: 'recipes', label: 'Recipes & portions', icon: BookOpen },
  { id: 'purchases', label: 'Purchases', icon: ShoppingCart },
  { id: 'reports', label: 'Stock reports', icon: ClipboardList },
  { id: 'waste', label: 'Waste log', icon: Trash2 }
];

export function estimateOrderIngredientCost(items) {
  try {
    const ingredients = JSON.parse(localStorage.getItem('malik-stock-ingredients') || '[]');
    const recipes = JSON.parse(localStorage.getItem('malik-stock-recipes') || '[]');
    let cost = 0, coveredUnits = 0, uncoveredUnits = 0;
    for (const sold of items || []) {
      const recipe = recipes.find(r => String(r.productId || '') === String(sold.id) && (!r.variant || r.variant === (sold.variant || '')))
        || recipes.find(r => r.productName?.trim().toLowerCase() === String(sold.name || '').trim().toLowerCase() && (!r.variant || r.variant === (sold.variant || '')));
      if (!recipe || !(recipe.ingredients || []).length) { uncoveredUnits += Math.max(0, Number(sold.qty) || 0); continue; }
      const lines = recipe.ingredients || [];
      const missing = lines.some(line => !ingredients.some(x => String(x.id) === String(line.ingredientId)));
      if (missing) { uncoveredUnits += Math.max(0, Number(sold.qty) || 0); continue; }
      cost += lines.reduce((sum, line) => {
        const ingredient = ingredients.find(x => String(x.id) === String(line.ingredientId));
        return sum + Math.max(0, Number(line.qty) || 0) * Math.max(0, Number(sold.qty) || 0) * Math.max(0, Number(ingredient?.cost) || 0);
      }, 0);
      coveredUnits += Math.max(0, Number(sold.qty) || 0);
    }
    return { cost, coveredUnits, uncoveredUnits };
  } catch { return { cost: 0, coveredUnits: 0, uncoveredUnits: (items || []).reduce((n, i) => n + Math.max(0, Number(i.qty) || 0), 0) }; }
}

export function consumeRecipeIngredients(items, orderId) {
  try {
    const ingredients = JSON.parse(localStorage.getItem('malik-stock-ingredients') || '[]');
    const recipes = JSON.parse(localStorage.getItem('malik-stock-recipes') || '[]');
    const movements = JSON.parse(localStorage.getItem('malik-stock-movements') || '[]');
    const batches = JSON.parse(localStorage.getItem('malik-stock-batches') || '[]').map(b => ({ ...b }));
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
        let remainingToConsume = amount;
        const today = new Date().toISOString().slice(0,10);
        const fifo = batches.filter(b => String(b.ingredientId) === String(ingredient.id) && Number(b.remainingQty) > 0 && (!b.expiryDate || b.expiryDate >= today)).sort((a,b) => String(a.receivedAt || a.date).localeCompare(String(b.receivedAt || b.date)));
        for (const batch of fifo) { if (remainingToConsume <= 0) break; const used = Math.min(Number(batch.remainingQty) || 0, remainingToConsume); batch.remainingQty = Number(batch.remainingQty) - used; remainingToConsume -= used; }
        newMovements.push({ id: Date.now() + Math.random(), date: new Date().toISOString(), ingredientId: ingredient.id, ingredientName: ingredient.name, type: 'sale', qty: -amount, unit: ingredient.unit, reference: orderId || 'Sale', note: (sold.name || recipe.productName) + ' × ' + sold.qty + (amount > 0 ? ' · FIFO batch consumption' : '') });
      }
    }
    if (newMovements.length) {
      localStorage.setItem('malik-stock-ingredients', JSON.stringify(next));
      localStorage.setItem('malik-stock-batches', JSON.stringify(batches));
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
  const [tab, setTab] = useState(() => readStock('activeTab', 'ingredients'));
  const [ingredients, setIngredients] = useState(() => { const saved=readStock('ingredients', null); if(saved!==null)return saved; const seeded=starterIngredients.map(x=>({...x})); try{localStorage.setItem('malik-stock-ingredients',JSON.stringify(seeded));}catch{} return seeded; });
  const [recipes, setRecipes] = useState(() => { const saved=readStock('recipes', null); return saved===null?[]:saved; });
  const [purchases, setPurchases] = useState(() => readStock('purchases', []));
  const [movements, setMovements] = useState(() => readStock('movements', []));
  const [batches, setBatches] = useState(() => readStock('batches', []));
  const [wasteRecords, setWasteRecords] = useState(() => readStock('waste-records', []));
  const [showWaste, setShowWaste] = useState(false);
  const [wasteDraft, setWasteDraft] = useState({ ingredientId: '', qty: '', reason: 'Preparation waste', staff: '', notes: '' });
  const [menuProducts, setMenuProducts] = useState(() => { try { return JSON.parse(localStorage.getItem('malik-products') || '[]'); } catch { return []; } });
  const [search, setSearch] = useState('');
  const [showIngredient, setShowIngredient] = useState(false);
  const [showRecipe, setShowRecipe] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const [purchasePayment, setPurchasePayment] = useState(null);
  const [ingredientDraft, setIngredientDraft] = useState({ name: '', sku: '', category: 'Food', unit: 'g', stock: '0', reorder: '0', cost: '0', supplier: '' });
  const [recipeDraft, setRecipeDraft] = useState({ productId: '', productName: '', variant: '', ingredients: [] });
  const [recipeLine, setRecipeLine] = useState({ ingredientId: '', qty: '' });
  const [purchaseDraft, setPurchaseDraft] = useState({ supplier: '', invoice: '', ingredientId: '', purchaseQty: '', purchaseUnit: 'carton', conversion: '1', unitCost: '', paid: '', expiryDate: '', notes: '' });

  const save = (key, value) => localStorage.setItem('malik-stock-' + key, JSON.stringify(value));
  useEffect(() => { save('activeTab', tab); }, [tab]);
  useEffect(() => {
    if (recipes.length || !menuProducts.length || !ingredients.length) return;
    const starter = menuProducts.map(p => starterRecipeFor(p, ingredients)).filter(Boolean);
    if (starter.length) { setRecipes(starter); save('recipes', starter); }
  }, [menuProducts, ingredients, recipes.length]);

  useEffect(() => {
    const refresh = () => {
      setIngredients(readStock('ingredients', [])); setRecipes(readStock('recipes', []));
      setPurchases(readStock('purchases', [])); setMovements(readStock('movements', [])); setBatches(readStock('batches', [])); setWasteRecords(readStock('waste-records', []));
      try { setMenuProducts(JSON.parse(localStorage.getItem('malik-products') || '[]')); } catch {}
    };
    window.addEventListener('malik-stock-updated', refresh);
    return () => window.removeEventListener('malik-stock-updated', refresh);
  }, []);
  const lowStock = ingredients.filter(x => Number(x.stock) <= Number(x.reorder));
  const todayISO = new Date().toISOString().slice(0,10);
  const expiryBatches = batches.filter(b => b.expiryDate && Number(b.remainingQty) > 0).sort((a,b) => String(a.expiryDate).localeCompare(String(b.expiryDate)));
  const expiredBatches = expiryBatches.filter(b => b.expiryDate < todayISO);
  const expiringSoonBatches = expiryBatches.filter(b => b.expiryDate >= todayISO && b.expiryDate <= new Date(Date.now()+7*86400000).toISOString().slice(0,10));
  const filteredIngredients = useMemo(() => ingredients.filter(x => (x.name + ' ' + x.sku + ' ' + x.category).toLowerCase().includes(search.toLowerCase())), [ingredients, search]);
  const ingredientValue = ingredients.reduce((n, x) => n + Number(x.stock || 0) * Number(x.cost || 0), 0);
  const supplierDues = purchases.reduce((n, p) => n + Math.max(0, Number(p.total || 0) - Number(p.paid || 0)), 0);
  const totalPurchaseSpend = purchases.reduce((n, p) => n + Number(p.total || 0), 0);
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
  function recordPurchasePayment(e) { e.preventDefault(); if (!purchasePayment) return; const amount = Number(purchasePayment.amount); const purchase = purchases.find(p => p.id === purchasePayment.id); const due = Math.max(0, Number(purchase?.total || 0) - Number(purchase?.paid || 0)); if (!purchase || !Number.isFinite(amount) || amount <= 0) { notify('Enter a payment amount greater than zero'); return; } if (amount > due) { notify('Payment cannot exceed this purchase balance'); return; } const date = new Date().toISOString(); const next = purchases.map(p => p.id === purchase.id ? { ...p, paid: Math.min(Number(p.total || 0), Number(p.paid || 0) + amount), paymentHistory: [...(p.paymentHistory || []), { id: 'SP-' + Date.now().toString().slice(-7), date, amount, note: purchasePayment.note.trim() }] } : p); setPurchases(next); save('purchases', next); setPurchasePayment(null); notify('Supplier payment recorded; purchase balance updated'); }

  function savePurchase(e) {
    e.preventDefault();
    const supplierRecords = (() => { try { return JSON.parse(localStorage.getItem('malik-suppliers') || '[]'); } catch { return []; } })();
    if (supplierRecords.some(x => x.blocked && String(x.name || '').trim().toLowerCase() === String(purchaseDraft.supplier || '').trim().toLowerCase())) { notify('This supplier is blocked. An administrator must unblock the supplier before recording a purchase.'); return; }
    const ingredient = ingredients.find(x => String(x.id) === String(purchaseDraft.ingredientId));
    const qty = Number(purchaseDraft.purchaseQty), conversion = Number(purchaseDraft.conversion), unitCost = Number(purchaseDraft.unitCost);
    if (!ingredient || qty <= 0 || conversion <= 0 || unitCost < 0 || !purchaseDraft.supplier.trim()) { notify('Enter supplier, ingredient, quantity, conversion and cost'); return; }
    const baseQty = qty * conversion, total = qty * unitCost;
    const oldStock = Number(ingredient.stock || 0), oldCost = Number(ingredient.cost || 0);
    const weightedCost = oldStock + baseQty > 0 ? ((oldStock * oldCost) + total) / (oldStock + baseQty) : total / baseQty;
    const nextIngredients = ingredients.map(x => String(x.id) === String(ingredient.id) ? { ...x, stock: oldStock + baseQty, cost: weightedCost, supplier: purchaseDraft.supplier.trim() } : x);
    const purchase = { id: 'PUR-' + Date.now().toString().slice(-7), date: new Date().toISOString(), supplier: purchaseDraft.supplier.trim(), invoice: purchaseDraft.invoice, ingredientId: ingredient.id, ingredientName: ingredient.name, purchaseQty: qty, purchaseUnit: purchaseDraft.purchaseUnit || ingredient.unit, conversion, baseQty, unit: ingredient.unit, unitCost, total, paid: Math.min(total, Math.max(0, Number(purchaseDraft.paid) || 0)), expiryDate: purchaseDraft.expiryDate || '', notes: purchaseDraft.notes };
    const batch = { id: 'BAT-' + Date.now().toString().slice(-7), purchaseId: purchase.id, receivedAt: purchase.date, date: purchase.date, expiryDate: purchaseDraft.expiryDate || '', ingredientId: ingredient.id, ingredientName: ingredient.name, supplier: purchase.supplier, invoice: purchase.invoice, receivedQty: baseQty, remainingQty: baseQty, unit: ingredient.unit, unitCost: conversion > 0 ? unitCost / conversion : 0 };
    const nextPurchases = [purchase, ...purchases];
    const nextBatches = [batch, ...batches];
    const movement = { id: Date.now(), date: purchase.date, ingredientId: ingredient.id, ingredientName: ingredient.name, type: 'purchase', qty: baseQty, unit: ingredient.unit, reference: purchase.id, note: purchaseDraft.supplier + (purchaseDraft.invoice ? ' · Invoice ' + purchaseDraft.invoice : '') };
    setIngredients(nextIngredients); save('ingredients', nextIngredients); setPurchases(nextPurchases); save('purchases', nextPurchases); setBatches(nextBatches); save('batches', nextBatches);
    const nextMovements = [movement, ...movements]; setMovements(nextMovements); save('movements', nextMovements);
    setPurchaseDraft({ supplier: '', invoice: '', ingredientId: '', purchaseQty: '', purchaseUnit: 'carton', conversion: '1', unitCost: '', paid: '', expiryDate: '', notes: '' }); setShowPurchase(false); notify('Purchase recorded with batch traceability');
  }
  function writeOffExpiredBatch(batchId) {
    const batch = batches.find(b => String(b.id) === String(batchId));
    if (!batch || Number(batch.remainingQty) <= 0 || !batch.expiryDate || batch.expiryDate >= todayISO) return;
    const qty = Number(batch.remainingQty);
    const nextBatches = batches.map(b => String(b.id) === String(batchId) ? { ...b, remainingQty: 0, writtenOffQty: qty, writeOffAt: new Date().toISOString() } : b);
    const nextIngredients = ingredients.map(i => String(i.id) === String(batch.ingredientId) ? { ...i, stock: Math.max(0, Number(i.stock || 0) - qty) } : i);
    const movement = { id: Date.now(), date: new Date().toISOString(), ingredientId: batch.ingredientId, ingredientName: batch.ingredientName, type: 'expired stock write-off', qty: -qty, unit: batch.unit, reference: batch.id, note: 'Expired batch write-off · supplier ' + batch.supplier + ' · purchase ' + batch.purchaseId + ' · estimated cost Rs. ' + (qty * Number(batch.unitCost || 0)).toFixed(2) };
    const nextMovements = [movement, ...movements]; setBatches(nextBatches); save('batches', nextBatches); setIngredients(nextIngredients); save('ingredients', nextIngredients); setMovements(nextMovements); save('movements', nextMovements); notify('Expired batch written off with stock movement and estimated cost');
  }

  function saveWaste(e) {
    e.preventDefault();
    const ingredient = ingredients.find(x => String(x.id) === String(wasteDraft.ingredientId));
    const qty = Number(wasteDraft.qty);
    if (!ingredient || !Number.isFinite(qty) || qty <= 0) { notify('Choose an ingredient and enter a positive waste quantity'); return; }
    if (qty > Number(ingredient.stock || 0)) { notify('Waste quantity cannot exceed the recorded on-hand stock'); return; }
    if (!wasteDraft.reason.trim() || !wasteDraft.staff.trim()) { notify('Enter a waste reason and the responsible staff member'); return; }
    const date = new Date().toISOString();
    const unitCost = Number(ingredient.cost || 0);
    const entry = { id: 'WST-' + Date.now().toString().slice(-7), date, ingredientId: ingredient.id, ingredientName: ingredient.name, qty, unit: ingredient.unit, unitCost, cost: qty * unitCost, reason: wasteDraft.reason.trim(), staff: wasteDraft.staff.trim(), notes: wasteDraft.notes.trim(), reference: 'WST-' + Date.now().toString().slice(-7) };
    const nextIngredients = ingredients.map(x => String(x.id) === String(ingredient.id) ? { ...x, stock: Number(x.stock || 0) - qty } : x);
    const movement = { id: Date.now(), date, ingredientId: ingredient.id, ingredientName: ingredient.name, type: 'waste', qty: -qty, unit: ingredient.unit, reference: entry.id, note: entry.reason + ' · Staff: ' + entry.staff + ' · Waste cost Rs. ' + entry.cost.toFixed(2) + (entry.notes ? ' · ' + entry.notes : '') };
    const nextMovements = [movement, ...movements], nextWaste = [entry, ...wasteRecords];
    setIngredients(nextIngredients); save('ingredients', nextIngredients);
    setMovements(nextMovements); save('movements', nextMovements);
    setWasteRecords(nextWaste); save('waste-records', nextWaste);
    setWasteDraft({ ingredientId: '', qty: '', reason: 'Preparation waste', staff: '', notes: '' }); setShowWaste(false);
    window.dispatchEvent(new CustomEvent('malik-stock-updated'));
    notify('Waste recorded: stock reduced and cost added to the waste log');
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
      <div className="ff-stock-stat"><span>Estimated stock value</span><b>{moneyStock(ingredientValue)}</b><small>On-hand quantity × weighted average cost</small></div>
      <div className="ff-stock-stat"><span>Supplier dues</span><b>{moneyStock(supplierDues)}</b><small>{purchases.length} recorded purchases · total spend {moneyStock(totalPurchaseSpend)}</small></div>
      <div className={'ff-stock-stat ' + (lowStock.length ? 'is-warning' : '')}><span>Low / reorder items</span><b>{lowStock.length}</b><small>At or below reorder level</small></div>
      <div className={'ff-stock-stat ' + (missingRecipes.length ? 'is-warning' : '')}><span>Menu items without recipes</span><b>{missingRecipes.length}</b><small>Sales won't consume ingredients until configured</small></div>
    </div>
    <div className="ff-stock-tabs">{tabs.map(t => <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}><t.icon size={16}/>{t.label}</button>)}</div>
    {tab === 'ingredients' && <div className="panel table-panel">
      <div className="table-toolbar"><div className="search-box"><Search size={16}/><input placeholder="Search ingredient, SKU or category" value={search} onChange={e => setSearch(e.target.value)}/></div><div className="toolbar-right"><button className="btn btn-secondary" onClick={() => setShowWaste(true)}><Trash2 size={16}/> Record waste</button><button className="btn btn-secondary" onClick={exportStock}>Export stock</button><button className="btn btn-primary" onClick={() => setShowIngredient(true)}><Plus size={16}/> Add ingredient</button></div></div>
      <div className="responsive-table"><table><thead><tr><th>INGREDIENT</th><th>CATEGORY</th><th>ON HAND</th><th>UNIT COST</th><th>STOCK VALUE</th><th>REORDER AT</th><th>STATUS</th><th></th></tr></thead><tbody>{filteredIngredients.map(x => <tr key={x.id}><td><b>{x.name}</b><div className="ff-muted">{x.sku || 'No SKU'} · {x.supplier || 'No supplier set'}</div></td><td>{x.category}</td><td><b>{Number(x.stock).toLocaleString()} {x.unit}</b></td><td>{moneyStock(x.cost)}</td><td>{moneyStock(Number(x.stock) * Number(x.cost))}</td><td>{x.reorder} {x.unit}</td><td><span className={'status-pill ' + (Number(x.stock) <= 0 ? 'status-out' : Number(x.stock) <= Number(x.reorder) ? 'status-low' : 'status-good')}>{Number(x.stock) <= 0 ? 'Out of stock' : Number(x.stock) <= Number(x.reorder) ? 'Reorder' : 'In stock'}</span></td><td><button className="icon-btn" title="Remove ingredient" onClick={() => removeIngredient(x.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table>{!filteredIngredients.length && <div className="empty-state"><Boxes size={28}/><b>No ingredients yet</b><span>Add bread, chicken, beef, milk, ice cream, sauces, cups and packaging as shared stock items.</span></div>}</div>
    </div>}
    {tab === 'recipes' && <div className="panel table-panel">
      <div className="table-toolbar"><div><b>Recipe & portion cards</b><div className="ff-muted">Quantities are consumed in each ingredient's base unit per one menu item.</div></div><button className="btn btn-primary" onClick={() => setShowRecipe(true)}><Plus size={16}/> Build recipe</button></div>
      <div className="responsive-table"><table><thead><tr><th>MENU ITEM</th><th>VARIANT</th><th>INGREDIENTS</th><th>EST. FOOD COST</th><th></th></tr></thead><tbody>{recipes.map(r => <tr key={r.id}><td><b>{r.productName}</b></td><td>{r.variant || 'Default / all variants'}</td><td><div className="ff-recipe-lines">{r.ingredients.map((line,i) => <span key={i}>{line.ingredientName}: {line.qty} {line.unit}</span>)}</div></td><td><b>{moneyStock(recipeCost(r))}</b></td><td><button className="icon-btn" title="Remove recipe" onClick={() => removeRecipe(r.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table>{!recipes.length && <div className="empty-state"><BookOpen size={28}/><b>No recipes configured</b><span>Create recipes for menu items and their portion sizes. Different variants can share the same ingredient.</span></div>}</div>
      {missingRecipes.length > 0 && <div className="ff-alert"><Utensils size={17}/><div><b>{missingRecipes.length} menu items need recipe setup</b><p>Unconfigured items will still sell, but will not deduct ingredient stock. Start with your best-selling items.</p></div></div>}
    </div>}
    {tab === 'purchases' && <div className="panel table-panel">
      <div className="table-toolbar"><div><b>Supplier purchases & batches</b><div className="ff-muted">Purchase receipts create traceable batches; FIFO sales consume oldest recorded batches first.</div></div><button className="btn btn-primary" onClick={() => setShowPurchase(true)}><Plus size={16}/> Record purchase</button></div>
      {(expiredBatches.length > 0 || expiringSoonBatches.length > 0) && <div className="ff-alert"><b>Expiry attention:</b> {expiredBatches.length} expired batch(es), {expiringSoonBatches.length} expiring within 7 days. Review remaining quantities below.</div>}
      <div className="responsive-table"><table><thead><tr><th>BATCH</th><th>INGREDIENT</th><th>RECEIVED</th><th>EXPIRY</th><th>REMAINING</th><th>STATUS / ACTION</th></tr></thead><tbody>{batches.filter(b => b.expiryDate).map(b => { const expired = b.expiryDate < todayISO && Number(b.remainingQty)>0; const soon = b.expiryDate >= todayISO && b.expiryDate <= new Date(Date.now()+7*86400000).toISOString().slice(0,10) && Number(b.remainingQty)>0; return <tr key={b.id}><td><b>{b.id}</b><div className="ff-muted">{b.purchaseId}</div></td><td>{b.ingredientName}<div className="ff-muted">{b.supplier}</div></td><td>{Number(b.receivedQty).toLocaleString()} {b.unit}</td><td>{b.expiryDate}</td><td>{Number(b.remainingQty).toLocaleString()} {b.unit}</td><td>{Number(b.remainingQty)<=0 ? 'Depleted' : expired ? <><span className="ff-negative">Expired</span> <button className="btn btn-secondary" onClick={() => writeOffExpiredBatch(b.id)}>Write off</button></> : soon ? <span className="ff-negative">Expiring soon</span> : 'In date'}</td></tr>; })}</tbody></table>{!batches.some(b => b.expiryDate) && <div className="empty-state"><Boxes size={24}/><b>No expiry-dated batches yet</b><span>Enter expiry dates on new purchase receipts to enable batch alerts and write-offs. Existing stock is not retroactively assigned an expiry date.</span></div>}</div>
      <div className="responsive-table"><table><thead><tr><th>DATE / REF</th><th>SUPPLIER</th><th>INGREDIENT</th><th>QUANTITY RECEIVED</th><th>TOTAL</th><th>PAID</th><th>DUE</th><th>ACTIONS</th></tr></thead><tbody>{purchases.map(p => <tr key={p.id}><td><b>{p.id}</b><div className="ff-muted">{new Date(p.date).toLocaleDateString()}</div></td><td>{p.supplier}<div className="ff-muted">{p.invoice || ''}</div></td><td>{p.ingredientName}</td><td>{p.purchaseQty} {p.purchaseUnit || 'packs'} × {p.conversion} {p.unit} = {p.baseQty} {p.unit}</td><td>{moneyStock(p.total)}</td><td>{moneyStock(p.paid)}</td><td><b>{moneyStock(Math.max(0,p.total-p.paid))}</b>{(p.paymentHistory||[]).length>0&&<div className="ff-muted">{p.paymentHistory.length} payment(s)</div>}</td><td>{Number(p.total)>Number(p.paid)&&<button className="btn btn-primary" onClick={() => setPurchasePayment({id:p.id,supplier:p.supplier,amount:String(Number(p.total)-Number(p.paid)),note:''})}>Pay due</button>}</td></tr>)}</tbody></table>{!purchases.length && <div className="empty-state"><ShoppingCart size={28}/><b>No purchases recorded</b><span>Record each supplier delivery to increase ingredient stock and track unpaid balances.</span></div>}</div>
    </div>}
    {tab === 'waste' && <div className="panel table-panel">
      <div className="panel-head"><div><h2>Ingredient waste register</h2><p>Each record reduces on-hand stock and captures reason, staff, quantity and estimated cost.</p></div><button className="btn btn-primary" onClick={() => setShowWaste(true)}><Plus size={16}/> Record waste</button></div>
      <div className="ff-stat-grid"><div className="ff-stat"><span>Total waste cost</span><b>{moneyStock(wasteRecords.reduce((n,w)=>n+Number(w.cost||0),0))}</b></div><div className="ff-stat"><span>Waste entries</span><b>{wasteRecords.length}</b></div><div className="ff-stat"><span>Quantity wasted</span><b>{wasteRecords.reduce((n,w)=>n+Number(w.qty||0),0).toLocaleString()}</b><small>Mixed units; see each record for unit</small></div></div>
      <div className="responsive-table"><table><thead><tr><th>DATE</th><th>INGREDIENT</th><th>QUANTITY</th><th>UNIT COST</th><th>WASTE COST</th><th>REASON</th><th>STAFF</th><th>NOTES</th></tr></thead><tbody>{wasteRecords.map(w=><tr key={w.id}><td>{new Date(w.date).toLocaleString()}</td><td><b>{w.ingredientName}</b></td><td>{w.qty} {w.unit}</td><td>{moneyStock(w.unitCost)}</td><td><b>{moneyStock(w.cost)}</b></td><td>{w.reason}</td><td>{w.staff}</td><td>{w.notes||'—'}</td></tr>)}</tbody></table>{!wasteRecords.length&&<div className="empty-state"><Trash2 size={28}/><b>No ingredient waste recorded</b><span>Record spoilage, prep loss, spills or other ingredient waste to track cost and stock impact.</span></div>}</div>
    </div>}
    {tab === 'reports' && <div className="panel table-panel">
      <div className="panel-head"><div><h2>Stock movement report</h2><p>Opening balances, purchases and recipe consumption</p></div><button className="btn btn-secondary" onClick={exportStock}>Export CSV</button></div>
      <div className="responsive-table"><table><thead><tr><th>DATE</th><th>INGREDIENT</th><th>MOVEMENT</th><th>QUANTITY</th><th>REFERENCE</th><th>NOTES</th></tr></thead><tbody>{movements.map(m => <tr key={m.id}><td>{new Date(m.date).toLocaleString()}</td><td><b>{m.ingredientName}</b></td><td>{m.type}</td><td className={m.qty < 0 ? 'ff-negative' : 'ff-positive'}>{m.qty > 0 ? '+' : ''}{m.qty} {m.unit}</td><td>{m.reference}</td><td>{m.note}</td></tr>)}</tbody></table>{!movements.length && <div className="empty-state"><TrendingUp size={28}/><b>No stock movements yet</b><span>Purchases and configured recipe sales will appear here.</span></div>}</div>
      <div className="ff-report-shortcuts">{['Low stock', 'Uncosted recipes', 'Supplier dues'].map(label => <button key={label} onClick={() => { if(label === 'Low stock') { setTab('ingredients'); setSearch(''); } else if(label === 'Uncosted recipes') setTab('recipes'); else setTab('purchases'); }}>{label} <TrendingDown size={15}/></button>)}</div>
    </div>}
    {showIngredient && <div className="modal-backdrop"><form className="modal" onSubmit={saveIngredient}><div className="modal-heading"><div><h2>Add ingredient</h2><p>Use one consistent base unit for every recipe.</p></div><button type="button" className="icon-btn" onClick={() => setShowIngredient(false)}><X size={16}/></button></div><label className="field-label">INGREDIENT NAME</label><input className="form-input" required autoFocus value={ingredientDraft.name} onChange={e => setIngredientDraft({...ingredientDraft,name:e.target.value})} placeholder="Chicken breast, burger bun, vanilla ice cream"/><div className="form-two"><div><label className="field-label">SKU / CODE</label><input className="form-input" value={ingredientDraft.sku} onChange={e => setIngredientDraft({...ingredientDraft,sku:e.target.value})}/></div><div><label className="field-label">CATEGORY</label><select className="form-input" value={ingredientDraft.category} onChange={e => setIngredientDraft({...ingredientDraft,category:e.target.value})}>{['Food','Meat','Dairy','Bakery','Sauce','Packaging','Beverage','Other'].map(x=><option key={x}>{x}</option>)}</select></div></div><div className="form-two"><div><label className="field-label">BASE UNIT</label><select className="form-input" value={ingredientDraft.unit} onChange={e => setIngredientDraft({...ingredientDraft,unit:e.target.value})}>{units.map(x=><option key={x}>{x}</option>)}</select></div><div><label className="field-label">OPENING STOCK ({ingredientDraft.unit})</label><input className="form-input" type="number" min="0" step="any" required value={ingredientDraft.stock} onChange={e => setIngredientDraft({...ingredientDraft,stock:e.target.value})}/></div></div><div className="form-two"><div><label className="field-label">COST PER BASE UNIT (Rs.)</label><input className="form-input" type="number" min="0" step="any" required value={ingredientDraft.cost} onChange={e => setIngredientDraft({...ingredientDraft,cost:e.target.value})}/></div><div><label className="field-label">REORDER LEVEL ({ingredientDraft.unit})</label><input className="form-input" type="number" min="0" step="any" value={ingredientDraft.reorder} onChange={e => setIngredientDraft({...ingredientDraft,reorder:e.target.value})}/></div></div><label className="field-label">PREFERRED SUPPLIER (OPTIONAL)</label><input className="form-input" value={ingredientDraft.supplier} onChange={e => setIngredientDraft({...ingredientDraft,supplier:e.target.value})}/><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowIngredient(false)}>Cancel</button><button className="btn btn-primary" type="submit">Save ingredient</button></div></form></div>}
    {showRecipe && <div className="modal-backdrop"><form className="modal ff-wide-modal" onSubmit={saveRecipe}><div className="modal-heading"><div><h2>Recipe & portion setup</h2><p>Ingredient quantities are per one sold menu item.</p></div><button type="button" className="icon-btn" onClick={() => setShowRecipe(false)}><X size={16}/></button></div><label className="field-label">MENU ITEM</label><select className="form-input" required value={recipeDraft.productId} onChange={e => { const p = menuProducts.find(x => String(x.id) === e.target.value); setRecipeDraft(old => ({...old,productId:e.target.value,productName:p?.name || old.productName,variant:p?.variant || ''})); }}><option value="">Select existing POS item</option>{menuProducts.map(p => <option key={p.id} value={p.id}>{p.name}{p.variant ? ' · ' + p.variant : ''}</option>)}</select>{!menuProducts.length && <div className="ff-alert">Add menu items in the POS catalog first.</div>}<label className="field-label">VARIANT / PORTION (OPTIONAL)</label><input className="form-input" value={recipeDraft.variant} onChange={e => setRecipeDraft({...recipeDraft,variant:e.target.value})} placeholder="Small, Large, 1 scoop, 2 scoops — leave blank for all variants"/><div className="form-two"><div><label className="field-label">INGREDIENT</label><select className="form-input" value={recipeLine.ingredientId} onChange={e => setRecipeLine({...recipeLine,ingredientId:e.target.value})}><option value="">Select ingredient</option>{ingredients.map(x => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div><div><label className="field-label">QUANTITY PER ITEM ({ingredients.find(x => String(x.id) === String(recipeLine.ingredientId))?.unit || 'unit'})</label><input className="form-input" type="number" min="0.001" step="any" value={recipeLine.qty} onChange={e => setRecipeLine({...recipeLine,qty:e.target.value})} placeholder="e.g. 80 for 80g scoop"/></div></div><button type="button" className="btn btn-secondary" onClick={addRecipeLine}><Plus size={15}/> Add ingredient to recipe</button><div className="ff-recipe-editor">{recipeDraft.ingredients.map((x,i) => <div key={i}><span>{x.ingredientName}</span><b>{x.qty} {x.unit}</b><button type="button" className="icon-btn" onClick={() => setRecipeDraft(old => ({...old,ingredients:old.ingredients.filter((_,j) => j !== i)}))}><Trash2 size={13}/></button></div>)}</div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowRecipe(false)}>Cancel</button><button className="btn btn-primary" type="submit">Save recipe</button></div></form></div>}
    {purchasePayment && <div className="modal-backdrop" onClick={() => setPurchasePayment(null)}><form className="modal" onClick={e => e.stopPropagation()} onSubmit={recordPurchasePayment}><div className="modal-heading"><div><h2>Pay supplier invoice</h2><p>{purchasePayment.supplier} · Ref {purchasePayment.id}</p></div><button type="button" className="icon-btn" onClick={() => setPurchasePayment(null)}><X size={16}/></button></div><label className="field-label">PAYMENT AMOUNT (Rs.)</label><input className="form-input" type="number" min="0.01" step="any" required value={purchasePayment.amount} onChange={e => setPurchasePayment({...purchasePayment,amount:e.target.value})}/><label className="field-label">PAYMENT REFERENCE / NOTE</label><input className="form-input" value={purchasePayment.note} onChange={e => setPurchasePayment({...purchasePayment,note:e.target.value})} placeholder="Cash, bank transfer, receipt no…"/><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setPurchasePayment(null)}>Cancel</button><button type="submit" className="btn btn-primary">Confirm supplier payment</button></div></form></div>}
    {showWaste && <div className="modal-backdrop"><form className="modal ff-wide-modal" onSubmit={saveWaste}><div className="modal-heading"><div><h2>Record ingredient waste</h2><p>Creates a stock movement and calculates waste cost from the ingredient's current unit cost.</p></div><button type="button" className="icon-btn" onClick={() => setShowWaste(false)}><X size={16}/></button></div><label className="field-label">INGREDIENT</label><select className="form-input" required value={wasteDraft.ingredientId} onChange={e=>setWasteDraft({...wasteDraft,ingredientId:e.target.value})}><option value="">Select ingredient</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name} · On hand {i.stock} {i.unit} · Cost {moneyStock(i.cost)}/{i.unit}</option>)}</select><div className="form-two"><div><label className="field-label">WASTE QUANTITY</label><input className="form-input" type="number" min="0.001" step="any" required value={wasteDraft.qty} onChange={e=>setWasteDraft({...wasteDraft,qty:e.target.value})}/></div><div><label className="field-label">REASON</label><select className="form-input" value={wasteDraft.reason} onChange={e=>setWasteDraft({...wasteDraft,reason:e.target.value})}><option>Preparation waste</option><option>Spoilage</option><option>Spillage</option><option>Overproduction</option><option>Expired ingredient</option><option>Quality issue</option><option>Other</option></select></div></div><label className="field-label">RESPONSIBLE STAFF</label><input className="form-input" required value={wasteDraft.staff} onChange={e=>setWasteDraft({...wasteDraft,staff:e.target.value})} placeholder="Staff name or ID"/><label className="field-label">NOTES / REFERENCE</label><textarea className="form-input" rows={2} value={wasteDraft.notes} onChange={e=>setWasteDraft({...wasteDraft,notes:e.target.value})} placeholder="Optional details, batch, order or incident reference"/>{wasteDraft.ingredientId&&<p className="settings-description">Estimated waste cost: {moneyStock((Number(wasteDraft.qty)||0)*Number(ingredients.find(i=>String(i.id)===String(wasteDraft.ingredientId))?.cost||0))}. On-hand stock: {ingredients.find(i=>String(i.id)===String(wasteDraft.ingredientId))?.stock||0} {ingredients.find(i=>String(i.id)===String(wasteDraft.ingredientId))?.unit||''}.</p>}<div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowWaste(false)}>Cancel</button><button type="submit" className="btn btn-primary">Post waste & stock movement</button></div></form></div>}
    {showPurchase && <div className="modal-backdrop"><form className="modal ff-wide-modal" onSubmit={savePurchase}><div className="modal-heading"><div><h2>Record ingredient purchase</h2><p>Convert supplier packaging into your stock base unit.</p></div><button type="button" className="icon-btn" onClick={() => setShowPurchase(false)}><X size={16}/></button></div><label className="field-label">SUPPLIER</label><input className="form-input" required value={purchaseDraft.supplier} onChange={e => setPurchaseDraft({...purchaseDraft,supplier:e.target.value})} placeholder="Supplier / vendor name"/><div className="form-two"><div><label className="field-label">PURCHASE PACK TYPE</label><input className="form-input" required value={purchaseDraft.purchaseUnit} onChange={e => setPurchaseDraft({...purchaseDraft,purchaseUnit:e.target.value})} placeholder="Carton, bag, tray, bottle"/></div><div><label className="field-label">INVOICE / BILL NUMBER</label><input className="form-input" value={purchaseDraft.invoice} onChange={e => setPurchaseDraft({...purchaseDraft,invoice:e.target.value})}/></div></div><div className="form-two"><div><label className="field-label">INGREDIENT</label><select className="form-input" required value={purchaseDraft.ingredientId} onChange={e => setPurchaseDraft({...purchaseDraft,ingredientId:e.target.value})}><option value="">Select ingredient</option>{ingredients.map(x => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div><div><label className="field-label">EXPIRY DATE (OPTIONAL)</label><input className="form-input" type="date" value={purchaseDraft.expiryDate} onChange={e => setPurchaseDraft({...purchaseDraft,expiryDate:e.target.value})} /></div></div><div className="form-two"><div><label className="field-label">PURCHASE QUANTITY (PACKS)</label><input className="form-input" type="number" min="0.001" step="any" required value={purchaseDraft.purchaseQty} onChange={e => setPurchaseDraft({...purchaseDraft,purchaseQty:e.target.value})} placeholder="10"/></div><div><label className="field-label">BASE UNITS PER PACK ({ingredients.find(x => String(x.id) === String(purchaseDraft.ingredientId))?.unit || "unit"})</label><input className="form-input" type="number" min="0.001" step="any" required value={purchaseDraft.conversion} onChange={e => setPurchaseDraft({...purchaseDraft,conversion:e.target.value})} placeholder="e.g. 10 kg per carton"/></div></div><div className="form-two"><div><label className="field-label">COST PER PACK (Rs.)</label><input className="form-input" type="number" min="0" step="any" required value={purchaseDraft.unitCost} onChange={e => setPurchaseDraft({...purchaseDraft,unitCost:e.target.value})}/></div><div><label className="field-label">AMOUNT PAID (Rs.)</label><input className="form-input" type="number" min="0" step="any" value={purchaseDraft.paid} onChange={e => setPurchaseDraft({...purchaseDraft,paid:e.target.value})} placeholder="0 if on credit"/></div></div><label className="field-label">NOTES</label><input className="form-input" value={purchaseDraft.notes} onChange={e => setPurchaseDraft({...purchaseDraft,notes:e.target.value})} placeholder="Optional delivery notes"/><div className="ff-purchase-preview">Received: <b>{((Number(purchaseDraft.purchaseQty)||0)*(Number(purchaseDraft.conversion)||0)).toLocaleString()} {ingredients.find(x => String(x.id) === String(purchaseDraft.ingredientId))?.unit || 'base units'}</b> · Total: <b>{moneyStock((Number(purchaseDraft.purchaseQty)||0)*(Number(purchaseDraft.unitCost)||0))}</b></div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowPurchase(false)}>Cancel</button><button className="btn btn-primary" type="submit">Post purchase & update stock</button></div></form></div>}
  </div>;
}
