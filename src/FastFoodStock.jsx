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
  ['Chicken breast / boneless chicken','Meat','g'],['Beef mince / patty','Meat','g'],['Burger bun','Bakery','each'],['Pizza dough / base','Bakery','each'],['Pita / shawarma bread','Bakery','each'],['Tortilla / wrap','Bakery','each'],['Potato / fries','Food','g'],['Mozzarella cheese','Dairy','g'],['Cheddar cheese','Dairy','g'],['Mayonnaise','Sauce','g'],['Garlic mayo / toum','Sauce','g'],['Pizza sauce','Sauce','g'],['Ketchup','Sauce','g'],['BBQ sauce','Sauce','g'],['Fajita seasoning','Food','g'],['Shawarma spice mix','Food','g'],['Lettuce','Food','g'],['Tomato','Food','g'],['Onion','Food','g'],['Capsicum / bell pepper','Food','g'],['Cucumber / pickle','Food','g'],['Cooking oil','Food','ml'],['Salt','Food','g'],['Black pepper','Food','g'],['Flour / maida','Food','g'],['Milk','Dairy','ml'],['Sugar','Food','g'],['Coffee','Beverage','g'],['Tea','Beverage','g'],['Ice cream','Dairy','g'],['Chocolate syrup','Sauce','g'],['Paper box / packaging','Packaging','each'],['Pasta / penne / spaghetti','Food','g'],['Basmati rice','Food','g'],['Yogurt','Dairy','g'],['Cream','Dairy','ml'],['Butter','Dairy','g'],['Parmesan cheese','Dairy','g'],['Egg','Food','each'],['Breadcrumbs','Food','g'],['Cornflour','Food','g'],['Wings','Meat','g'],['Chicken mince','Meat','g'],['Biryani masala','Food','g'],['Ginger garlic paste','Food','g'],['Lemon juice','Food','ml'],['Chilli sauce','Sauce','g'],['Pickle / jalapeno','Food','g'],['Cabbage','Food','g'],['Carrot','Food','g'],['Peas','Food','g'],['Apple','Food','g'],['Pineapple','Food','g'],['Mango','Food','g'],['Banana','Food','g'],['Ice','Food','g'],['Water','Beverage','ml'],['Mint / coriander','Food','g'],['Oregano','Food','g'],['Yeast','Food','g'],['Honey','Food','g'],['Hot sauce','Sauce','g'],['Cheddar sauce','Sauce','g'],['Paratha','Bakery','each'],['Bread slices','Bakery','each'],['Pasta sauce','Sauce','g']
].map((x,i)=>({id:'starter-'+(i+1),name:x[0],sku:'ING-'+String(i+1).padStart(3,'0'),category:x[1],unit:x[2],stock:0,reorder:0,cost:0,supplier:'',starter:true}));

const ingredientCostSeeds = {
  'Chicken breast / boneless chicken':0.57, 'Chicken mince':0.57, 'Wings':0.57,
  'Beef mince / patty':0.9, 'Milk':0.165, 'Egg':21.67, 'Flour / maida':0.11,
  'Basmati rice':0.31, 'Sugar':0.156, 'Cooking oil':0.6, 'Potato / fries':0.026,
  'Tomato':0.1, 'Onion':0.19, 'Capsicum / bell pepper':0.3, 'Ginger garlic paste':0.29,
  'Lemon juice':0.25, 'Mint / coriander':0.35, 'Salt':0.08, 'Tea':2.1, 'Coffee':3.5,
  'Mozzarella cheese':0.95, 'Cheddar cheese':1.1, 'Parmesan cheese':2.2,
  'Pizza dough / base':35, 'Burger bun':22, 'Pita / shawarma bread':18, 'Tortilla / wrap':20,
  'Paratha':25, 'Bread slices':8, 'Pasta / penne / spaghetti':0.55, 'Yogurt':0.25,
  'Cream':0.85, 'Butter':1.0, 'Mayonnaise':0.65, 'Garlic mayo / toum':0.7,
  'Pizza sauce':0.32, 'Ketchup':0.35, 'BBQ sauce':0.65, 'Chilli sauce':0.4,
  'Hot sauce':0.6, 'Cheddar sauce':0.85, 'Pasta sauce':0.45, 'Chocolate syrup':0.8,
  'Ice cream':0.7, 'Fajita seasoning':1.4, 'Shawarma spice mix':1.2, 'Biryani masala':1.5,
  'Oregano':2.5, 'Black pepper':2.5, 'Cornflour':0.18, 'Breadcrumbs':0.25,
  'Lettuce':0.18, 'Cucumber / pickle':0.35, 'Cabbage':0.09, 'Carrot':0.1, 'Peas':0.22,
  'Apple':0.28, 'Pineapple':0.35, 'Mango':0.25, 'Banana':0.18, 'Ice':0.03, 'Water':0.002,
  'Yeast':0.8, 'Honey':1.1, 'Pickle / jalapeno':0.65, 'Paper box / packaging':12,
  'Capsicum / bell pepper':0.3
};
const ingredientPriceSource = 'Punjab FS&CPD notified Bhakkar rates dated 2026-10-20 for published staples; other items are editable local-market estimates.';

const starterRecipeFor = (p, ingredients) => {
  const name=String(p.name||'').toLowerCase(), variant=String(p.variant||'').trim();
  const sizeText=(variant+' '+name).toLowerCase();
  const pick=(n,q)=>{const x=ingredients.find(i=>i.name.toLowerCase()===n.toLowerCase());return x?{ingredientId:x.id,ingredientName:x.name,qty:q,unit:x.unit}:null;};
  const lines=[], add=(n,q)=>{const x=pick(n,q);if(x)lines.push(x);};
  const factor=/\b(xl|extra large|xxl)\b/.test(sizeText)?1.65:/\b(large|lg)\b/.test(sizeText)?1.35:/\b(medium|med)\b/.test(sizeText)?1.15:/\b(small|personal)\b/.test(sizeText)?0.8:1;
  let portion=variant;
  if(/pizza/.test(name)){
    portion=portion||(/\b(xl|extra large|xxl)\b/.test(name)?'XL':/\blarge\b/.test(name)?'Large':/\bmedium\b/.test(name)?'Medium':/\bsmall\b/.test(name)?'Small':'Standard');
    add('Pizza dough / base',({Small:180,Medium:250,Large:350,XL:450,Standard:250}[portion]||250));
    add('Pizza sauce',Math.round(60*factor));add('Mozzarella cheese',Math.round(100*factor));
    if(/chicken|fajita|shawarma|tikka|bbq|special|meat/.test(name))add('Chicken breast / boneless chicken',Math.round(80*factor));
    if(/fajita|mexican/.test(name)){add('Capsicum / bell pepper',Math.round(25*factor));add('Onion',Math.round(20*factor));add('Fajita seasoning',Math.round(4*factor));}
    if(/bbq/.test(name))add('BBQ sauce',Math.round(25*factor));add('Oregano',1);add('Cooking oil',3);
  } else if(/shawarma|shwarma/.test(name)){add('Pita / shawarma bread',1);add('Chicken breast / boneless chicken',150);add('Garlic mayo / toum',25);add('Chilli sauce',8);add('Lettuce',15);add('Tomato',20);add('Onion',10);add('Shawarma spice mix',5);add('Lemon juice',5);}
  else if(/fajita/.test(name)){add('Tortilla / wrap',1);add('Chicken breast / boneless chicken',120);add('Capsicum / bell pepper',25);add('Onion',20);add('Fajita seasoning',5);add('Mayonnaise',15);add('Mozzarella cheese',20);}
  else if(/zinger|chicken burger|burger|hamburger/.test(name)){add('Burger bun',1);add(/beef|smash/.test(name)?'Beef mince / patty':'Chicken breast / boneless chicken',150);add('Mayonnaise',20);add('Ketchup',10);add('Lettuce',15);add('Tomato',20);add('Cheddar cheese',20);if(/zinger|crispy/.test(name)){add('Flour / maida',25);add('Cornflour',10);add('Breadcrumbs',20);add('Cooking oil',15);}}
  else if(/pasta|alfredo|spaghetti|macaroni/.test(name)){add('Pasta / penne / spaghetti',120);add('Chicken breast / boneless chicken',90);add(/alfredo|creamy/.test(name)?'Cream':'Pasta sauce',100);add('Milk',40);add('Parmesan cheese',12);add('Butter',10);add('Black pepper',1);}
  else if(/biryani|pulao/.test(name)){add('Basmati rice',150);add('Chicken breast / boneless chicken',150);add('Yogurt',40);add('Onion',40);add('Tomato',30);add('Ginger garlic paste',10);add('Biryani masala',8);add('Cooking oil',15);add('Mint / coriander',3);}
  else if(/paratha|kathi roll/.test(name)){add('Paratha',1);add('Chicken breast / boneless chicken',120);add('Mayonnaise',20);add('Chilli sauce',8);add('Onion',15);add('Cabbage',15);add('Lemon juice',3);}
  else if(/sandwich|club/.test(name)){add('Bread slices',3);add('Chicken breast / boneless chicken',90);add('Mayonnaise',20);add('Cheddar cheese',20);add('Lettuce',10);add('Tomato',15);add('Butter',5);}
  else if(/loaded fries|bbq fries|cheese fries/.test(name)){add('Potato / fries',250);add('Cooking oil',15);add('Chicken breast / boneless chicken',60);add('Cheddar sauce',40);add('Mozzarella cheese',25);add(/bbq/.test(name)?'BBQ sauce':'Garlic mayo / toum',15);}
  else if(/fries|chips/.test(name)){add('Potato / fries',200);add('Cooking oil',20);add('Salt',2);add('Ketchup',20);}
  else if(/nugget/.test(name)){add('Chicken mince',150);add('Flour / maida',20);add('Egg',0.5);add('Breadcrumbs',30);add('Cooking oil',15);add('Salt',2);add('Black pepper',1);}
  else if(/wing/.test(name)){add('Wings',300);add('Flour / maida',20);add('Hot sauce',30);add('Butter',10);add('Honey',8);add('Cooking oil',15);}
  else if(/tender/.test(name)){add('Chicken breast / boneless chicken',150);add('Flour / maida',25);add('Breadcrumbs',25);add('Egg',0.5);add('Cooking oil',20);}
  else if(/coffee|latte|cappuccino|mocha/.test(name)){add('Coffee',10);add('Milk',200);add('Sugar',10);}
  else if(/tea|chai/.test(name)){add('Tea',4);add('Milk',140);add('Water',80);add('Sugar',10);}
  else if(/shake|smoothie|frappe/.test(name)){add('Milk',180);add('Ice cream',80);add('Mango',80);add('Banana',40);add('Ice',50);add('Sugar',8);}
  else return null;
  return {id:'starter-recipe-'+p.id,productId:String(p.id),productName:p.name,variant:variant||'',ingredients:lines,starter:true,portionNote:'Illustrative starter portion per menu item. Weigh-test and approve before relying on stock deductions.'};
};


const recipeLibraryCategories = ['Shawarma','Burgers','Pizza','Sauces','Dough','Pasta','Sandwich','Paratha Rolls','Hot Wings','Loaded Fries','BBQ Fries','Nuggets','Biryani','Special Pizza','Special Shawarma','Tea','Coffee','Russian Salad','Smoothies','Other Specials'];
const defaultRecipeLibrary = [
 {id:'lib-shawarma-classic',name:'Classic Creamy Chicken Shawarma',category:'Shawarma',servings:'1 wrap',ingredients:'Boneless chicken 150 g; pita/khubz 1; garlic sauce 25 g; lettuce 15 g; tomato 20 g; onion 10 g; shawarma spice 5 g; lemon juice 5 ml; oil 5 ml; salt to taste.',method:'Marinate chicken with spices, lemon, oil and salt for at least 30 minutes. Cook fully on a hot griddle and slice thinly. Warm bread, spread garlic sauce, add chicken and vegetables, roll tightly and toast briefly.',notes:'Starter formula. Keep raw and cooked chicken separate; cook poultry to 74°C / 165°F.'},
 {id:'lib-shawarma-spicy',name:'Spicy Smoky Shawarma',category:'Shawarma',servings:'1 wrap',ingredients:'Chicken 150 g; wrap 1; garlic mayo 20 g; chilli sauce 10 g; smoked paprika 2 g; cumin 1 g; lemon 5 ml; pickle 15 g; onion 10 g.',method:'Season chicken with paprika, cumin, lemon and salt; cook through on a hot griddle. Mix garlic mayo and chilli sauce. Fill warm wrap with sauce, chicken, pickle and onion; roll and toast.',notes:'Adjust chilli and sauce to your customers’ heat preference.'},
 {id:'lib-burger-classic',name:'Signature Smash Cheeseburger',category:'Burgers',servings:'1 burger',ingredients:'Beef patty 150 g; burger bun 1; cheddar 1 slice; onion 15 g; pickle 15 g; lettuce 10 g; burger sauce 25 g; salt and pepper.',method:'Toast bun. Season patty and cook on a very hot griddle, turning as needed until safely cooked. Melt cheese over patty. Spread sauce on bun and assemble with onion, pickle and lettuce.',notes:'Use a verified safe internal temperature for ground beef; keep patty size consistent.'},
 {id:'lib-burger-zinger',name:'Crunchy Zinger Chicken Burger',category:'Burgers',servings:'1 burger',ingredients:'Chicken fillet 150 g; bun 1; flour 35 g; cornflour 15 g; paprika 2 g; garlic powder 2 g; buttermilk 40 ml; lettuce 15 g; mayo 25 g; oil for frying.',method:'Season chicken and soak in buttermilk. Mix flour, cornflour and spices. Coat chicken, press crumbs on firmly and fry until crisp and cooked through. Toast bun and assemble with mayo and lettuce.',notes:'Frying time depends on thickness; verify 74°C / 165°F at the centre.'},
 {id:'lib-pizza-margherita',name:'Classic Margherita Pizza',category:'Pizza',servings:'1 pizza (10–12 inch)',ingredients:'Pizza dough 250 g; pizza sauce 60 g; mozzarella 100 g; oregano 1 g; olive oil 5 ml; fresh basil optional.',method:'Stretch dough, spread a thin even layer of sauce, add mozzarella and oregano. Bake in a fully preheated hot oven until crust is browned and cheese bubbles. Finish with basil and a little olive oil.',notes:'Oven temperature and bake time depend on your oven and dough.'},
 {id:'lib-pizza-fajita',name:'Chicken Fajita Pizza',category:'Special Pizza',servings:'1 pizza (10–12 inch)',ingredients:'Pizza dough 250 g; pizza sauce 60 g; mozzarella 100 g; cooked chicken 90 g; capsicum 30 g; onion 20 g; fajita seasoning 4 g; oil 5 ml.',method:'Season and cook chicken with capsicum and onion. Spread sauce on stretched dough, add cheese and cooked topping. Bake until the crust is browned and cheese melts.',notes:'Keep topping moisture controlled to avoid a soggy centre.'},
 {id:'lib-pizza-bbq',name:'Smoky BBQ Chicken Pizza',category:'Special Pizza',servings:'1 pizza (10–12 inch)',ingredients:'Pizza dough 250 g; mozzarella 100 g; BBQ sauce 45 g; cooked chicken 100 g; red onion 20 g; capsicum 20 g.',method:'Spread a light layer of BBQ sauce on dough. Add mozzarella, chicken, onion and capsicum. Bake in a preheated oven until crust is crisp and toppings are hot.',notes:'Use cooked chicken and avoid excessive sauce.'},
 {id:'lib-sauce-garlic',name:'Creamy Garlic Mayo',category:'Sauces',servings:'About 200 g',ingredients:'Mayonnaise 160 g; garlic paste 12 g; lemon juice 10 ml; cold water 10–20 ml; salt 1 g.',method:'Whisk mayonnaise, garlic and lemon. Add cold water gradually to a pourable consistency. Season, cover and refrigerate promptly.',notes:'Keep chilled; use clean utensils and follow local holding-time rules.'},
 {id:'lib-sauce-burger',name:'House Burger Sauce',category:'Sauces',servings:'About 250 g',ingredients:'Mayonnaise 150 g; ketchup 45 g; mustard 15 g; finely chopped pickle 20 g; paprika 2 g; garlic powder 1 g; lemon juice 5 ml.',method:'Mix until uniform. Rest chilled for 20–30 minutes for flavour to blend, then portion with a clean squeeze bottle.',notes:'Adjust sweet, tangy and smoky notes to taste.'},
 {id:'lib-dough-pizza',name:'Pizza Dough (Same-Day)',category:'Dough',servings:'4 dough balls',ingredients:'Bread flour 600 g; water 360 g; instant yeast 5 g; salt 12 g; sugar 8 g; olive oil 15 g.',method:'Mix flour, water and yeast until shaggy. Add salt, sugar and oil; knead until smooth. Cover and rise until expanded. Divide into four equal balls, rest covered, then stretch gently.',notes:'Flour absorption and rise time vary by brand and room temperature.'},
 {id:'lib-pasta-alfredo',name:'Creamy Chicken Alfredo Pasta',category:'Pasta',servings:'1 plate',ingredients:'Pasta 120 g dry; chicken 100 g; cream 100 ml; milk 40 ml; parmesan 15 g; garlic 4 g; butter 10 g; black pepper; salt.',method:'Boil pasta in salted water until just tender. Sauté garlic and chicken until chicken is cooked through. Add cream and milk, simmer gently, stir in cheese and pasta water as needed, then toss with pasta.',notes:'Do not hold cream sauce at room temperature; serve promptly.'},
 {id:'lib-sandwich-club',name:'Grilled Chicken Club Sandwich',category:'Sandwich',servings:'1 sandwich',ingredients:'Bread 3 slices; cooked chicken 90 g; cheese 1 slice; lettuce 15 g; tomato 20 g; mayonnaise 20 g; butter 5 g.',method:'Toast or butter-grill bread. Spread mayo, layer chicken, cheese and vegetables, stack and cut. Serve immediately with fries if desired.',notes:'Standardize bread size and chicken portion.'},
 {id:'lib-paratha-roll',name:'Crispy Chicken Paratha Roll',category:'Paratha Rolls',servings:'1 roll',ingredients:'Paratha 1; cooked spicy chicken 120 g; mint mayo 20 g; onion 15 g; cabbage 15 g; lemon 5 ml.',method:'Cook chicken with house spices until fully cooked. Heat paratha until crisp. Add sauce, chicken, onion and cabbage, squeeze lemon, roll tightly in food paper.',notes:'For a juicier roll, add sauce after cooking rather than to raw chicken.'},
 {id:'lib-wings',name:'Sticky Hot Wings',category:'Hot Wings',servings:'6 wings',ingredients:'Chicken wings 6; flour 20 g; paprika 2 g; garlic powder 2 g; salt; oil for cooking; hot sauce 35 g; butter 15 g; honey 10 g.',method:'Pat wings dry and season. Coat lightly if using flour, then bake or fry until crisp and cooked through. Warm hot sauce, butter and honey together; toss wings just before serving.',notes:'Check thickest part reaches 74°C / 165°F.'},
 {id:'lib-loaded-fries',name:'Cheesy Loaded Fries',category:'Loaded Fries',servings:'1 tray',ingredients:'Fries 250 g; cheddar sauce 50 g; mozzarella 35 g; cooked chicken 60 g; jalapeño/pickle 15 g; garlic mayo 15 g.',method:'Cook fries until crisp. Add cheese sauce, mozzarella and hot cooked chicken; melt briefly under a salamander/oven. Finish with pickles and garlic mayo.',notes:'Assemble just before service to retain crispness.'},
 {id:'lib-bbq-fries',name:'BBQ Chicken Fries',category:'BBQ Fries',servings:'1 tray',ingredients:'Fries 250 g; cooked chicken 70 g; BBQ sauce 35 g; cheddar 40 g; onion 10 g; spring onion optional.',method:'Cook fries crisp. Toss chicken with BBQ sauce and heat thoroughly. Top fries with chicken and cheddar; melt cheese, then garnish with onion.',notes:'Avoid over-saucing the fries.'},
 {id:'lib-nuggets',name:'Crispy Chicken Nuggets',category:'Nuggets',servings:'8 nuggets',ingredients:'Chicken mince 150 g; salt 2 g; pepper 1 g; garlic powder 1 g; flour 20 g; egg wash 25 g; breadcrumbs 35 g; oil for frying.',method:'Season chicken and form equal nuggets. Coat in flour, egg wash and breadcrumbs. Fry or bake until golden and centre reaches 74°C / 165°F.',notes:'Use a thermometer; colour alone does not confirm safe doneness.'},
 {id:'lib-biryani',name:'Chicken Dum Biryani',category:'Biryani',servings:'1 plate',ingredients:'Basmati rice 150 g dry; chicken 180 g; yogurt 50 g; onion 50 g; tomato 40 g; ginger-garlic 15 g; biryani masala 8 g; oil/ghee 20 g; mint/coriander; whole spices; salt.',method:'Parboil rinsed rice with whole spices until partly cooked. Prepare masala with browned onion, ginger-garlic, tomato, yogurt and spices; cook chicken through. Layer rice and masala with herbs, seal and steam on low heat until rice is tender.',notes:'Batch cooking needs rapid cooling and safe hot holding under local food-safety rules.'},
 {id:'lib-tea',name:'Doodh Patti Chai',category:'Tea',servings:'1 cup (200 ml)',ingredients:'Water 80 ml; milk 140 ml; black tea 3–4 g; sugar 8–12 g or to taste; cardamom optional.',method:'Bring water and tea to a simmer. Add milk and sugar, simmer gently while watching the pot, strain and serve hot.',notes:'Keep cup size and tea dose consistent.'},
 {id:'lib-coffee',name:'Creamy Café Coffee',category:'Coffee',servings:'1 cup (250 ml)',ingredients:'Coffee/espresso 30–40 ml or instant coffee 2 g; milk 200 ml; sugar/syrup to taste.',method:'Prepare coffee base. Steam or heat milk, combine and finish with foam if available. Serve immediately.',notes:'For iced coffee, blend the coffee with chilled milk and ice separately.'},
 {id:'lib-russian-salad',name:'Russian Salad',category:'Russian Salad',servings:'1 side portion',ingredients:'Boiled potato 80 g; boiled carrot 40 g; peas 25 g; apple 25 g; pineapple 25 g; mayonnaise 45 g; salt and pepper; lemon juice optional.',method:'Dice cooled cooked vegetables and fruit evenly. Fold through mayonnaise, season, cover and chill promptly. Serve cold with a clean chilled spoon.',notes:'Keep refrigerated; label preparation time and discard according to your food-safety plan.'},
 {id:'lib-smoothie',name:'Mango Banana Smoothie',category:'Smoothies',servings:'1 glass (350 ml)',ingredients:'Mango 120 g; banana 60 g; chilled milk or yogurt 180 ml; ice 60 g; honey/sugar optional.',method:'Blend fruit, milk/yogurt and ice until smooth. Taste, adjust sweetness, pour into a chilled glass and serve immediately.',notes:'Use ripe fruit and consistent fruit weights for repeatable flavour.'},
 {id:'lib-shawarma-special',name:'Malik Special Shawarma',category:'Special Shawarma',servings:'1 wrap',ingredients:'Chicken 150 g; pita 1; garlic mayo 20 g; chilli sauce 10 g; cheese 20 g; fries 30 g; pickle 15 g; shawarma spices 5 g.',method:'Marinate and cook chicken fully. Warm pita, spread garlic mayo and chilli sauce, add chicken, cheese, a small portion of fries and pickle. Roll tightly and toast until cheese melts.',notes:'Signature concept—taste-test sauce balance and portion cost before making it your house standard.'}
];

const tabs = [
  { id: 'ingredients', label: 'Ingredients & stock', icon: Boxes },
  { id: 'recipes', label: 'Recipes & portions', icon: BookOpen },
  { id: 'library', label: 'Recipe Library', icon: Utensils },
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
  const [ingredients, setIngredients] = useState(() => { const saved=readStock('ingredients', null); const existing=Array.isArray(saved)?saved:[]; const names=new Set(existing.map(x=>String(x.name||'').trim().toLowerCase())); const merged=[...existing,...starterIngredients.filter(x=>!names.has(x.name.toLowerCase())).map(x=>({...x}))]; try{if(saved===null||merged.length!==existing.length)localStorage.setItem('malik-stock-ingredients',JSON.stringify(merged));}catch{} return merged; });
  const [recipes, setRecipes] = useState(() => { const saved=readStock('recipes', null); return saved===null?[]:saved; });
  const [libraryRecipes, setLibraryRecipes] = useState(() => { try { const saved=JSON.parse(localStorage.getItem('malik-recipe-library')||'null'); return Array.isArray(saved)&&saved.length?saved:defaultRecipeLibrary; } catch { return defaultRecipeLibrary; } });
  const [libraryCategory, setLibraryCategory] = useState('All');
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryDraft, setLibraryDraft] = useState({name:'',category:'Shawarma',servings:'1 portion',ingredients:'',method:'',notes:''});
  const [editingLibraryRecipe, setEditingLibraryRecipe] = useState(null);
  const [showLibraryEditor, setShowLibraryEditor] = useState(false);
  const [purchases, setPurchases] = useState(() => readStock('purchases', []));
  const [purchaseSearch, setPurchaseSearch] = useState('');
  const [purchaseBalanceFilter, setPurchaseBalanceFilter] = useState('all');
  const [purchaseAgingFilter, setPurchaseAgingFilter] = useState('all');
  const [purchaseSort, setPurchaseSort] = useState('newest');
  const [purchaseFromDate, setPurchaseFromDate] = useState('');
  const [purchaseToDate, setPurchaseToDate] = useState('');
  const [movements, setMovements] = useState(() => readStock('movements', []));
  const [movementSearch, setMovementSearch] = useState('');
  const [movementTypeFilter, setMovementTypeFilter] = useState('all');
  const [movementFromDate, setMovementFromDate] = useState('');
  const [movementToDate, setMovementToDate] = useState('');
  const [batches, setBatches] = useState(() => readStock('batches', []));
  const [wasteRecords, setWasteRecords] = useState(() => readStock('waste-records', []));
  const [showWaste, setShowWaste] = useState(false);
  const [wasteDraft, setWasteDraft] = useState({ ingredientId: '', qty: '', reason: 'Preparation waste', staff: '', notes: '' });
  const [menuProducts, setMenuProducts] = useState(() => { try { return JSON.parse(localStorage.getItem('malik-products') || '[]'); } catch { return []; } });
  const [search, setSearch] = useState('');
  const [showIngredient, setShowIngredient] = useState(false);
  const [editingIngredient, setEditingIngredient] = useState(null);
  const [editingRecipe, setEditingRecipe] = useState(null);
  const [showRecipe, setShowRecipe] = useState(false);
  const [showPurchase, setShowPurchase] = useState(false);
  const [purchasePayment, setPurchasePayment] = useState(null);
  const [purchaseHistoryView, setPurchaseHistoryView] = useState(null);
  const [ingredientDraft, setIngredientDraft] = useState({ name: '', sku: '', category: 'Food', unit: 'g', stock: '0', reorder: '0', cost: '0', supplier: '' });
  const [recipeDraft, setRecipeDraft] = useState({ productId: '', productName: '', variant: '', ingredients: [] });
  const [recipeLine, setRecipeLine] = useState({ ingredientId: '', qty: '' });
  const [purchaseDraft, setPurchaseDraft] = useState({ supplier: '', invoice: '', ingredientId: '', purchaseQty: '', purchaseUnit: 'carton', conversion: '1', unitCost: '', paid: '', expiryDate: '', notes: '' });

  const save = (key, value) => localStorage.setItem('malik-stock-' + key, JSON.stringify(value));
  useEffect(() => { save('activeTab', tab); }, [tab]);
  useEffect(() => {
    const marker = 'malik-stock-ingredient-prices-v1';
    if (localStorage.getItem(marker)) return;
    const next = ingredients.map(item => {
      const seeded = ingredientCostSeeds[item.name];
      if (seeded == null || Number(item.cost) > 0) return item;
      return { ...item, cost: seeded, costSource: ingredientPriceSource, costUpdatedAt: '2026-10-20' };
    });
    if (JSON.stringify(next) !== JSON.stringify(ingredients)) {
      setIngredients(next);
      localStorage.setItem('malik-stock-ingredients', JSON.stringify(next));
      window.dispatchEvent(new CustomEvent('malik-stock-updated'));
    }
    localStorage.setItem(marker, JSON.stringify({ date: '2026-10-20', source: 'Punjab FS&CPD plus estimates', currency: 'PKR' }));
  }, [ingredients]);

  useEffect(() => {
    if (!menuProducts.length || !ingredients.length) return;
    const generated = [];
    const sizeSets = [
      {test:/pizza/, sizes:['Small','Medium','Large','XL']},
      {test:/shawarma|wrap|roll|burger|sandwich|pasta|fries|chips|nugget|wing|tender|biryani|rice|tea|chai|coffee|latte|smoothie|shake|frappe|fajita/, sizes:['Small','Regular','Large']}
    ];
    for (const p of menuProducts) {
      const base = starterRecipeFor({...p,variant:p.variant||''}, ingredients);
      if (!base) continue;
      const sizeSet = sizeSets.find(s=>s.test.test(String(p.name||'').toLowerCase()));
      if (!sizeSet) { generated.push(base); continue; }
      const knownVariant=String(p.variant||'').trim();
      const variants = knownVariant ? [knownVariant] : sizeSet.sizes;
      for (const variant of variants) {
        const recipe=starterRecipeFor({...p,variant}, ingredients);
        if (!recipe) continue;
        const size=variant.toLowerCase();
        const factor=/xl|extra large|xxl/.test(size)?1.65:/large|lg/.test(size)?1.35:/medium|med/.test(size)?1.15:/small|personal/.test(size)?0.8:1;
        recipe.ingredients=recipe.ingredients.map(line=>{
          let qty=Number(line.qty)||0;
          if (/pizza/.test(String(p.name||'').toLowerCase()) && /dough \/ base/i.test(line.ingredientName)) qty=({small:180,medium:250,large:350,xl:450}[size]||250);
          else if (/pizza/.test(String(p.name||'').toLowerCase())) qty=qty;
          else if (size!=='regular' && size!=='standard') qty=Math.round(qty*factor*100)/100;
          return {...line,qty};
        });
        recipe.variant=variant;
        generated.push(recipe);
      }
    }
    const key = r => String(r.productId||'')+'::'+String(r.variant||'').trim().toLowerCase();
    const starterByKey = new Map(generated.map(r=>[key(r),r]));
    const next=recipes.map(r=>r.starter&&starterByKey.has(key(r))?starterByKey.get(key(r)):r);
    const existingKeys=new Set(next.map(key));
    for(const recipe of generated) if(!existingKeys.has(key(recipe))){next.push(recipe);existingKeys.add(key(recipe));}
    if(JSON.stringify(next)!==JSON.stringify(recipes)){setRecipes(next);save('recipes',next);}
  }, [menuProducts, ingredients, recipes]);

  // On first stock setup, provision enough shared ingredients for 100 portions of every recipe the menu can currently calculate. Never rerun after the setup marker is written.
  useEffect(() => {
    if (!menuProducts.length || !recipes.length || !ingredients.length) return;
    const setupKey = 'malik-stock-opening-100-sales-v1';
    if (localStorage.getItem(setupKey)) return;
    const knownProductIds = new Set(recipes.map(r => String(r.productId || '')));
    if (!menuProducts.some(p => knownProductIds.has(String(p.id)))) return;
    const required = new Map();
    for (const recipe of recipes) {
      if (!recipe || !(recipe.ingredients || []).length) continue;
      for (const line of recipe.ingredients) {
        const id = String(line.ingredientId || '');
        const qty = Math.max(0, Number(line.qty) || 0) * 100;
        if (id && qty > 0) required.set(id, (required.get(id) || 0) + qty);
      }
    }
    if (!required.size) return;
    const nextIngredients = ingredients.map(item => {
      const minimum = required.get(String(item.id)) || 0;
      return minimum > 0 && Number(item.stock || 0) < minimum
        ? { ...item, stock: minimum, openingStockFor100Sales: minimum }
        : item;
    });
    localStorage.setItem('malik-stock-ingredients', JSON.stringify(nextIngredients));
    localStorage.setItem(setupKey, JSON.stringify({
      completedAt: new Date().toISOString(),
      targetSalesPerRecipe: 100,
      recipeCount: recipes.filter(r => (r.ingredients || []).length).length,
      menuProductCount: menuProducts.length,
      uncoveredProducts: menuProducts.filter(p => !recipes.some(r => String(r.productId || '') === String(p.id))).map(p => ({ id: p.id, name: p.name }))
    }));
    setIngredients(nextIngredients);
    window.dispatchEvent(new CustomEvent('malik-stock-updated'));
  }, [menuProducts, recipes, ingredients]);
  
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
  const filteredMovements = useMemo(() => movements.filter(m => {
    const q = movementSearch.trim().toLowerCase();
    const matches = !q || [m.ingredientName, m.type, m.reference, m.note, m.unit].some(v => String(v || '').toLowerCase().includes(q));
    const date = String(m.date || '').slice(0, 10);
    const afterStart = !movementFromDate || (date && date >= movementFromDate);
    const beforeEnd = !movementToDate || (date && date <= movementToDate);
    return matches && afterStart && beforeEnd && (movementTypeFilter === 'all' || String(m.type || '').toLowerCase() === movementTypeFilter);
  }).sort((a,b) => new Date(b.date || 0) - new Date(a.date || 0)), [movements, movementSearch, movementTypeFilter, movementFromDate, movementToDate]);
  const filteredPurchases = useMemo(() => purchases.filter(p => {
    const q = purchaseSearch.trim().toLowerCase();
    const matches = !q || [p.id, p.supplier, p.invoice, p.ingredientName, p.notes].some(v => String(v || '').toLowerCase().includes(q));
    const due = Math.max(0, Number(p.total || 0) - Number(p.paid || 0));
    const purchaseDate = String(p.date || '').slice(0, 10);
    const inDateRange = (!purchaseFromDate || purchaseDate >= purchaseFromDate) && (!purchaseToDate || purchaseDate <= purchaseToDate);
    const timestamp = new Date(p.date || '').getTime();
    const daysOpen = Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 86400000)) : null;
    const agingMatches = purchaseAgingFilter === 'all' || (due > 0 && purchaseAgingFilter === 'recent' && daysOpen !== null && daysOpen <= 7) || (due > 0 && purchaseAgingFilter === 'medium' && daysOpen !== null && daysOpen > 7 && daysOpen <= 30) || (due > 0 && purchaseAgingFilter === 'old' && daysOpen !== null && daysOpen > 30) || (due > 0 && purchaseAgingFilter === 'unknown' && daysOpen === null);
    return matches && inDateRange && agingMatches && (purchaseBalanceFilter === 'all' || (purchaseBalanceFilter === 'due' && due > 0) || (purchaseBalanceFilter === 'paid' && due <= 0));
  }).sort((a,b) => purchaseSort === 'oldest-due' ? ((Number(a.total || 0) > Number(a.paid || 0) ? new Date(a.date || 0).getTime() : Infinity) - (Number(b.total || 0) > Number(b.paid || 0) ? new Date(b.date || 0).getTime() : Infinity)) || new Date(b.date || 0) - new Date(a.date || 0) : new Date(b.date || 0) - new Date(a.date || 0)), [purchases, purchaseSearch, purchaseBalanceFilter, purchaseAgingFilter, purchaseSort, purchaseFromDate, purchaseToDate]);
  const purchaseFilteredTotals = useMemo(() => filteredPurchases.reduce((totals, purchase) => {
    const total = Math.max(0, Number(purchase.total || 0));
    const paid = Math.min(total, Math.max(0, Number(purchase.paid || 0)));
    totals.total += total; totals.paid += paid; totals.due += Math.max(0, total - paid); return totals;
  }, { total: 0, paid: 0, due: 0 }), [filteredPurchases]);
  const purchaseAging = useMemo(() => purchases.reduce((aging, purchase) => {
    const due = Math.max(0, Number(purchase.total || 0) - Number(purchase.paid || 0));
    if (!due) return aging;
    const timestamp = new Date(purchase.date || '').getTime();
    if (!Number.isFinite(timestamp)) { aging.unknown += due; aging.unknownCount += 1; return aging; }
    const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86400000));
    const bucket = days <= 7 ? 'recent' : days <= 30 ? 'medium' : 'old';
    aging[bucket] += due; aging[bucket + 'Count'] += 1;
    return aging;
  }, { recent: 0, medium: 0, old: 0, unknown: 0, recentCount: 0, mediumCount: 0, oldCount: 0, unknownCount: 0 }), [purchases]);
  function exportPurchasePayments() {
    const rows = [['Purchase ID','Purchase Date','Supplier','Invoice','Payment ID','Payment Date','Amount PKR','Note'], ...filteredPurchases.flatMap(p => (p.paymentHistory || []).map(payment => [p.id, p.date || '', p.supplier || '', p.invoice || '', payment.id || '', payment.date || '', Number(payment.amount || 0), payment.note || '']))];
    const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = 'malik-pos-supplier-payments-' + new Date().toISOString().slice(0,10) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Supplier payment ledger exported');
  }
  function exportBatches() {
    const rows = [['Batch ID','Purchase ID','Received Date','Expiry Date','Ingredient','Supplier','Invoice','Received Quantity','Remaining Quantity','Unit','Unit Cost per Base Unit PKR','Estimated Remaining Value PKR','Status']];
    for (const batch of batches) {
      const remaining = Math.max(0, Number(batch.remainingQty || 0));
      const expiry = String(batch.expiryDate || '');
      const status = remaining <= 0 ? 'Depleted' : expiry && expiry < todayISO ? 'Expired - review/write off' : expiry && expiry <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0,10) ? 'Expiring within 7 days' : expiry ? 'In date' : 'No expiry recorded';
      const purchase = purchases.find(p => String(p.id) === String(batch.purchaseId));
      rows.push([batch.id || '', batch.purchaseId || '', batch.receivedAt || batch.date || '', expiry, batch.ingredientName || '', batch.supplier || '', batch.invoice || '', Number(batch.receivedQty || 0), remaining, batch.unit || '', Number(batch.unitCost || 0), remaining * Number(batch.unitCost || 0), status]);
    }
    const csv = '\\uFEFF' + rows.map(row => row.map(value => '\"' + String(value ?? '').replaceAll('\"', '\"\"') + '\"').join(',')).join('\\r\\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = 'malik-pos-stock-batches-' + new Date().toISOString().slice(0,10) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Stock batch report exported');
  }
  function exportPurchases() {
    const rows = [['Purchase ID','Date','Supplier','Invoice','Ingredient','Purchase Quantity','Pack Unit','Base Units per Pack','Received Base Quantity','Base Unit','Unit Cost per Pack PKR','Total PKR','Paid PKR','Due PKR','Days Open','Expiry Date','Notes','Payment History'], ...filteredPurchases.map(p => [p.id, p.date || '', p.supplier || '', p.invoice || '', p.ingredientName || '', Number(p.purchaseQty || 0), p.purchaseUnit || '', Number(p.conversion || 0), Number(p.baseQty || 0), p.unit || '', Number(p.unitCost || 0), Number(p.total || 0), Number(p.paid || 0), Math.max(0, Number(p.total || 0) - Number(p.paid || 0)), Number(p.total || 0) > Number(p.paid || 0) && Number.isFinite(new Date(p.date).getTime()) ? Math.max(0, Math.floor((Date.now() - new Date(p.date).getTime()) / 86400000)) : '', p.expiryDate || '', p.notes || '', (p.paymentHistory || []).map(payment => [payment.date ? new Date(payment.date).toLocaleString() : 'Date not recorded', 'Rs. ' + Number(payment.amount || 0).toFixed(2), payment.note || ''].join(' · ')).join(' | ')])];
    const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = 'malik-pos-purchase-invoices-' + new Date().toISOString().slice(0,10) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Purchase invoice report exported');
  }
  function exportSupplierPayments() {
    const rows = [['Payment ID','Payment Date','Purchase ID','Supplier','Invoice','Ingredient','Payment Amount PKR','Note']];
    for (const purchase of filteredPurchases) {
      for (const [index, payment] of (purchase.paymentHistory || []).entries()) {
        rows.push([payment.id || ('PAY-' + (index + 1)), payment.date || '', purchase.id || '', purchase.supplier || '', purchase.invoice || '', purchase.ingredientName || '', Number(payment.amount || 0), payment.note || '']);
      }
    }
    if (rows.length === 1) { notify('No recorded invoice payments in the current filter'); return; }
    const csv = '\uFEFF' + rows.map(row => row.map(value => '"' + String(value ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = 'malik-pos-supplier-payment-ledger-' + new Date().toISOString().slice(0,10) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Supplier payment ledger exported');
  }
  const missingRecipes = menuProducts.filter(p => !recipes.some(r => String(r.productId || '') === String(p.id) || r.productName?.trim().toLowerCase() === String(p.name || '').trim().toLowerCase()));

  function saveIngredient(e) {
    e.preventDefault();
    if (!ingredientDraft.name.trim() || Number(ingredientDraft.stock) < 0 || Number(ingredientDraft.cost) < 0) { notify('Enter a name and valid stock/cost'); return; }
    const item = { ...ingredientDraft, id: editingIngredient?.id ?? Date.now(), name: ingredientDraft.name.trim(), stock: Number(ingredientDraft.stock) || 0, reorder: Number(ingredientDraft.reorder) || 0, cost: Number(ingredientDraft.cost) || 0 };
    const next = editingIngredient ? ingredients.map(x => String(x.id)===String(editingIngredient.id)?item:x) : [item, ...ingredients]; setIngredients(next); save('ingredients', next);
    setIngredientDraft({ name: '', sku: '', category: 'Food', unit: 'g', stock: '0', reorder: '0', cost: '0', supplier: '' }); setShowIngredient(false); setEditingIngredient(null);
    if (!editingIngredient) setMovements(old => { const m = [{ id: Date.now() + 1, date: new Date().toISOString(), ingredientId: item.id, ingredientName: item.name, type: 'opening', qty: item.stock, unit: item.unit, reference: 'Opening balance', note: 'Opening stock' }, ...old]; save('movements', m); return m; });
    notify(editingIngredient ? 'Ingredient updated' : 'Ingredient added');
  }
  function saveRecipe(e) {
    e.preventDefault();
    if (!recipeDraft.productName.trim() || !recipeDraft.ingredients.length) { notify('Choose a menu item and add at least one ingredient'); return; }
    const recipe = { ...recipeDraft, id: editingRecipe?.id ?? Date.now(), productId: recipeDraft.productId || '', ingredients: recipeDraft.ingredients.map(x => ({ ...x, qty: Number(x.qty) || 0 })), starter: false };
    const next = [recipe, ...recipes.filter(r => !(String(r.productId || '') === String(recipe.productId) && r.variant === recipe.variant) && !(r.productName.toLowerCase() === recipe.productName.toLowerCase() && r.variant === recipe.variant))];
    setRecipes(next); save('recipes', next); setRecipeDraft({ productId: '', productName: '', variant: '', ingredients: [] }); setShowRecipe(false); setEditingRecipe(null); notify(editingRecipe ? 'Recipe updated' : 'Recipe saved');
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
    const invoiceRef = String(purchaseDraft.invoice || '').trim().toLowerCase();
    const supplierRef = String(purchaseDraft.supplier || '').trim().toLowerCase();
    const ingredientRef = ingredients.find(x => String(x.id) === String(purchaseDraft.ingredientId));
    const duplicateInvoiceLine = invoiceRef && purchases.some(p => String(p.supplier || '').trim().toLowerCase() === supplierRef && String(p.invoice || '').trim().toLowerCase() === invoiceRef && String(p.ingredientId) === String(ingredientRef?.id));
    if (duplicateInvoiceLine && !window.confirm('A purchase for this supplier, invoice number and ingredient already exists. Record another line anyway?')) return;
    const ingredient = ingredientRef;
    const qty = Number(purchaseDraft.purchaseQty), conversion = Number(purchaseDraft.conversion), unitCost = Number(purchaseDraft.unitCost), paidAmount = Number(purchaseDraft.paid || 0);
    if (!ingredient || !purchaseDraft.supplier.trim() || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(conversion) || conversion <= 0 || !Number.isFinite(unitCost) || unitCost < 0 || !Number.isFinite(paidAmount) || paidAmount < 0) { notify('Enter a supplier, ingredient, positive quantity and conversion, and valid costs'); return; }
    const baseQty = qty * conversion, total = qty * unitCost;
    if (!Number.isFinite(baseQty) || !Number.isFinite(total) || baseQty <= 0 || total < 0) { notify('Purchase quantity or total is outside the supported range'); return; }
    if (paidAmount > total) { notify('Amount paid cannot exceed the purchase total'); return; }
    const initialPaid = Number(purchaseDraft.paid || 0);
    if (!Number.isFinite(initialPaid) || initialPaid < 0 || initialPaid > total) { notify('Amount paid must be between Rs. 0 and the purchase total (' + moneyStock(total) + ')'); return; }
    const oldStock = Number(ingredient.stock || 0), oldCost = Number(ingredient.cost || 0);
    const weightedCost = oldStock + baseQty > 0 ? ((oldStock * oldCost) + total) / (oldStock + baseQty) : total / baseQty;
    const nextIngredients = ingredients.map(x => String(x.id) === String(ingredient.id) ? { ...x, stock: oldStock + baseQty, cost: weightedCost, supplier: purchaseDraft.supplier.trim() } : x);
    const purchaseDate = new Date().toISOString();
    const purchase = { id: 'PUR-' + Date.now().toString().slice(-7), date: purchaseDate, supplier: purchaseDraft.supplier.trim(), invoice: purchaseDraft.invoice, ingredientId: ingredient.id, ingredientName: ingredient.name, purchaseQty: qty, purchaseUnit: purchaseDraft.purchaseUnit || ingredient.unit, conversion, baseQty, unit: ingredient.unit, unitCost, total, paid: initialPaid, paymentHistory: initialPaid > 0 ? [{ id: 'SP-' + Date.now().toString().slice(-7), date: purchaseDate, amount: initialPaid, note: 'Initial payment at purchase' }] : [], expiryDate: purchaseDraft.expiryDate || '', notes: purchaseDraft.notes };
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
  function exportMovements() {
    const rows = [['Date','Ingredient','Movement Type','Quantity','Unit','Reference','Notes'], ...filteredMovements.map(m => [m.date || '', m.ingredientName || '', m.type || '', Number(m.qty || 0), m.unit || '', m.reference || '', m.note || ''])];
    const csv = '\uFEFF' + rows.map(row => row.map(v => '"' + String(v ?? '').replaceAll('"', '""') + '"').join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a'); a.href = url; a.download = 'malik-pos-stock-movements-' + new Date().toISOString().slice(0,10) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    notify('Stock movement report exported');
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
      <div className="responsive-table"><table><thead><tr><th>INGREDIENT</th><th>CATEGORY</th><th>ON HAND</th><th>UNIT COST</th><th>STOCK VALUE</th><th>REORDER AT</th><th>STATUS</th><th></th></tr></thead><tbody>{filteredIngredients.map(x => <tr key={x.id}><td><b>{x.name}</b><div className="ff-muted">{x.sku || 'No SKU'} · {x.supplier || 'No supplier set'}</div></td><td>{x.category}</td><td><b>{Number(x.stock).toLocaleString()} {x.unit}</b></td><td>{moneyStock(x.cost)}</td><td>{moneyStock(Number(x.stock) * Number(x.cost))}</td><td>{x.reorder} {x.unit}</td><td><span className={'status-pill ' + (Number(x.stock) <= 0 ? 'status-out' : Number(x.stock) <= Number(x.reorder) ? 'status-low' : 'status-good')}>{Number(x.stock) <= 0 ? 'Out of stock' : Number(x.stock) <= Number(x.reorder) ? 'Reorder' : 'In stock'}</span></td><td><button className="icon-btn" title="Edit ingredient" onClick={() => {setEditingIngredient(x);setIngredientDraft({name:x.name||'',sku:x.sku||'',category:x.category||'Food',unit:x.unit||'g',stock:String(x.stock??0),reorder:String(x.reorder??0),cost:String(x.cost??0),supplier:x.supplier||''});setShowIngredient(true);}}><BookOpen size={14}/></button><button className="icon-btn" title="Remove ingredient" onClick={() => removeIngredient(x.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table>{!filteredIngredients.length && <div className="empty-state"><Boxes size={28}/><b>No ingredients yet</b><span>Add bread, chicken, beef, milk, ice cream, sauces, cups and packaging as shared stock items.</span></div>}</div>
    </div>}
    {tab === 'recipes' && <div className="panel table-panel">
      <div className="table-toolbar"><div><b>Recipe & portion cards</b><div className="ff-muted">Quantities are consumed in each ingredient's base unit per one menu item.</div></div><button className="btn btn-primary" onClick={() => setShowRecipe(true)}><Plus size={16}/> Build recipe</button></div>
      <div className="responsive-table"><table><thead><tr><th>MENU ITEM</th><th>VARIANT</th><th>INGREDIENTS</th><th>EST. FOOD COST</th><th></th></tr></thead><tbody>{recipes.map(r => <tr key={r.id}><td><b>{r.productName}</b></td><td>{r.variant || 'Default / all variants'}</td><td><div className="ff-recipe-lines">{r.ingredients.map((line,i) => <span key={i}>{line.ingredientName}: {line.qty} {line.unit}</span>)}</div></td><td><b>{moneyStock(recipeCost(r))}</b></td><td><button className="icon-btn" title="Edit recipe" onClick={() => {setEditingRecipe(r);setRecipeDraft({productId:String(r.productId||''),productName:r.productName||'',variant:r.variant||'',ingredients:(r.ingredients||[]).map(x=>({...x}))});setRecipeLine({ingredientId:'',qty:''});setShowRecipe(true);}}><BookOpen size={14}/></button><button className="icon-btn" title="Remove recipe" onClick={() => removeRecipe(r.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table>{!recipes.length && <div className="empty-state"><BookOpen size={28}/><b>No recipes configured</b><span>Create recipes for menu items and their portion sizes. Different variants can share the same ingredient.</span></div>}</div>
      {missingRecipes.length > 0 && <div className="ff-alert"><Utensils size={17}/><div><b>{missingRecipes.length} menu items need recipe setup</b><p>Unconfigured items will still sell, but will not deduct ingredient stock. Start with your best-selling items.</p></div></div>}
    </div>}

    {tab === 'library' && <div className="panel table-panel">
      <div className="table-toolbar"><div><b>Malik Signature Recipe Library</b><div className="ff-muted">Editable reference recipes and serving guides. These are starter ideas to test and standardize for your shop—not secret or guaranteed award-winning formulas.</div></div><button className="btn btn-primary" onClick={() => {setEditingLibraryRecipe(null);setLibraryDraft({name:'',category:'Shawarma',servings:'1 portion',ingredients:'',method:'',notes:''});setShowLibraryEditor(true);}}><Plus size={16}/> Add own recipe</button></div>
      <div className="table-toolbar"><div className="search-box"><Search size={16}/><input placeholder="Search recipe, ingredients or method" value={librarySearch} onChange={e=>setLibrarySearch(e.target.value)}/></div><select className="form-input" style={{maxWidth:240}} value={libraryCategory} onChange={e=>setLibraryCategory(e.target.value)}><option>All</option>{recipeLibraryCategories.map(c=><option key={c}>{c}</option>)}</select></div>
      <div className="ff-recipe-library-grid">{libraryRecipes.filter(r=>(libraryCategory==='All'||r.category===libraryCategory)&&[r.name,r.category,r.ingredients,r.method].join(' ').toLowerCase().includes(librarySearch.toLowerCase())).map(r=><article className="ff-library-card" key={r.id}><div className="ff-library-card-head"><span className="status-pill status-good">{r.category}</span><button className="icon-btn" title="Edit recipe" onClick={()=>{setEditingLibraryRecipe(r);setLibraryDraft({name:r.name,category:r.category,servings:r.servings,ingredients:r.ingredients,method:r.method,notes:r.notes||''});setShowLibraryEditor(true);}}><BookOpen size={14}/></button></div><h3>{r.name}</h3><div className="ff-muted">Yield / portion: {r.servings}</div><b>Ingredients</b><p>{r.ingredients}</p><b>Method</b><p>{r.method}</p>{r.notes&&<div className="ff-alert"><span>{r.notes}</span></div>}</article>)}</div>
      {!libraryRecipes.length&&<div className="empty-state"><BookOpen size={28}/><b>No saved recipes</b><span>Add your own recipe cards above.</span></div>}
      <p className="ff-muted">Recipe cards are separate from stock-deduction recipes. To deduct ingredients automatically from sales, also configure the matching menu item under “Recipes & portions”.</p>
    </div>}

    {tab === 'purchases' && <div className="panel table-panel">
      <div className="table-toolbar"><div><b>Supplier purchases & batches</b><div className="ff-muted">Purchase receipts create traceable batches; FIFO sales consume oldest recorded batches first.</div></div><div className="toolbar-right"><button className="btn btn-secondary" onClick={exportBatches}>Export batch report</button><button className="btn btn-primary" onClick={() => setShowPurchase(true)}><Plus size={16}/> Record purchase</button></div></div>
      <div className="ff-stat-grid"><div className="ff-stat"><span>Purchase invoices</span><b>{purchases.length}</b><small>{purchases.filter(p=>Math.max(0,Number(p.total||0)-Number(p.paid||0))>0).length} outstanding</small></div><div className="ff-stat"><span>Total purchase value</span><b>{moneyStock(totalPurchaseSpend)}</b></div><div className="ff-stat"><span>Paid to suppliers</span><b>{moneyStock(purchases.reduce((n,p)=>n+Math.min(Number(p.total||0),Math.max(0,Number(p.paid||0))),0))}</b></div><div className="ff-stat"><span>Outstanding balance</span><b>{moneyStock(supplierDues)}</b></div></div>
      {(expiredBatches.length > 0 || expiringSoonBatches.length > 0) && <div className="ff-alert"><b>Expiry attention:</b> {expiredBatches.length} expired batch(es), {expiringSoonBatches.length} expiring within 7 days. Review remaining quantities below.</div>}
      <div className="ff-stat-grid">
        <div className="ff-stat"><span>Purchase value</span><b>{moneyStock(totalPurchaseSpend)}</b><small>All recorded supplier invoices</small></div>
        <div className="ff-stat"><span>Paid to suppliers</span><b>{moneyStock(purchases.reduce((n, p) => n + Number(p.paid || 0), 0))}</b><small>Payments entered against invoices</small></div>
        <div className="ff-stat"><span>Outstanding balance</span><b>{moneyStock(supplierDues)}</b><small>{purchases.filter(p => Number(p.total || 0) > Number(p.paid || 0)).length} invoice(s) with due amounts</small></div>
        <div className="ff-stat"><span>Fully paid invoices</span><b>{purchases.filter(p => Number(p.total || 0) <= Number(p.paid || 0)).length}</b><small>Includes invoices with zero due</small></div>
      </div>
      <div className="ff-stat-grid">
        <div className="ff-stat"><span>Due · 0–7 days</span><b>{moneyStock(purchaseAging.recent)}</b><small>{purchaseAging.recentCount} invoice(s)</small></div>
        <div className="ff-stat"><span>Due · 8–30 days</span><b>{moneyStock(purchaseAging.medium)}</b><small>{purchaseAging.mediumCount} invoice(s)</small></div>
        <div className="ff-stat"><span>Due · over 30 days</span><b>{moneyStock(purchaseAging.old)}</b><small>{purchaseAging.oldCount} invoice(s)</small></div>
        {purchaseAging.unknownCount > 0 && <div className="ff-stat"><span>Due · date unavailable</span><b>{moneyStock(purchaseAging.unknown)}</b><small>{purchaseAging.unknownCount} invoice(s) need date review</small></div>}
      </div>
      <div className="responsive-table"><table><thead><tr><th>BATCH</th><th>INGREDIENT</th><th>RECEIVED</th><th>EXPIRY</th><th>REMAINING</th><th>STATUS / ACTION</th></tr></thead><tbody>{batches.filter(b => b.expiryDate).map(b => { const expired = b.expiryDate < todayISO && Number(b.remainingQty)>0; const soon = b.expiryDate >= todayISO && b.expiryDate <= new Date(Date.now()+7*86400000).toISOString().slice(0,10) && Number(b.remainingQty)>0; return <tr key={b.id}><td><b>{b.id}</b><div className="ff-muted">{b.purchaseId}</div></td><td>{b.ingredientName}<div className="ff-muted">{b.supplier}</div></td><td>{Number(b.receivedQty).toLocaleString()} {b.unit}</td><td>{b.expiryDate}</td><td>{Number(b.remainingQty).toLocaleString()} {b.unit}</td><td>{Number(b.remainingQty)<=0 ? 'Depleted' : expired ? <><span className="ff-negative">Expired</span> <button className="btn btn-secondary" onClick={() => writeOffExpiredBatch(b.id)}>Write off</button></> : soon ? <span className="ff-negative">Expiring soon</span> : 'In date'}</td></tr>; })}</tbody></table>{!batches.some(b => b.expiryDate) && <div className="empty-state"><Boxes size={24}/><b>No expiry-dated batches yet</b><span>Enter expiry dates on new purchase receipts to enable batch alerts and write-offs. Existing stock is not retroactively assigned an expiry date.</span></div>}</div>
      <div className="ff-stat-grid"><div className="ff-stat"><span>Filtered invoice value</span><b>{moneyStock(purchaseFilteredTotals.total)}</b><small>{filteredPurchases.length} invoice(s)</small></div><div className="ff-stat"><span>Payments recorded</span><b>{moneyStock(purchaseFilteredTotals.paid)}</b><small>For the filtered invoices</small></div><div className="ff-stat"><span>Outstanding balance</span><b>{moneyStock(purchaseFilteredTotals.due)}</b><small>For the filtered invoices</small></div></div>
      <div className="table-toolbar"><div className="toolbar-left"><input className="form-input" value={purchaseSearch} onChange={e => setPurchaseSearch(e.target.value)} placeholder="Search supplier, invoice, ingredient or ID" aria-label="Search purchase invoices"/><select className="form-input" value={purchaseBalanceFilter} onChange={e => setPurchaseBalanceFilter(e.target.value)} aria-label="Filter purchase payment status"><option value="all">All invoices</option><option value="due">Outstanding only</option><option value="paid">Fully paid</option></select><select className="form-input" value={purchaseAgingFilter} onChange={e => setPurchaseAgingFilter(e.target.value)} aria-label="Filter outstanding invoice age"><option value="all">All invoice ages</option><option value="recent">Due · 0–7 days</option><option value="medium">Due · 8–30 days</option><option value="old">Due · over 30 days</option><option value="unknown">Due · date unavailable</option></select><select className="form-input" value={purchaseSort} onChange={e => setPurchaseSort(e.target.value)} aria-label="Sort purchase invoices"><option value="newest">Newest first</option><option value="oldest-due">Oldest outstanding first</option></select><input className="form-input" type="date" value={purchaseFromDate} max={purchaseToDate || undefined} onChange={e => setPurchaseFromDate(e.target.value)} aria-label="Purchases from date" title="Purchases from date"/><input className="form-input" type="date" value={purchaseToDate} min={purchaseFromDate || undefined} onChange={e => setPurchaseToDate(e.target.value)} aria-label="Purchases to date" title="Purchases to date"/></div><div className="toolbar-right"><span className="ff-muted">{filteredPurchases.length} of {purchases.length}</span><button className="btn btn-secondary" onClick={exportPurchases}>Export CSV</button><button className="btn btn-secondary" onClick={exportPurchasePayments}>Export payment ledger</button><button className="btn btn-secondary" onClick={exportSupplierPayments}>Export payments</button><button className="btn btn-secondary" onClick={() => { setPurchaseSearch(''); setPurchaseBalanceFilter('all'); setPurchaseAgingFilter('all'); setPurchaseSort('newest'); setPurchaseFromDate(''); setPurchaseToDate(''); }}>Clear filters</button></div></div><div className="responsive-table"><table><thead><tr><th>DATE / REF</th><th>SUPPLIER</th><th>INGREDIENT</th><th>QUANTITY RECEIVED</th><th>TOTAL</th><th>PAID</th><th>DUE</th><th>DAYS OPEN</th><th>ACTIONS</th></tr></thead><tbody>{filteredPurchases.map(p => <tr key={p.id}><td><b>{p.id}</b><div className="ff-muted">{new Date(p.date).toLocaleDateString()}</div></td><td>{p.supplier}<div className="ff-muted">{p.invoice || ''}</div>{(p.paymentHistory || []).length > 0 && <details className="ff-payment-history"><summary>Payment history ({p.paymentHistory.length})</summary><div className="ff-payment-history-list">{p.paymentHistory.map((payment, index) => <div className="ff-payment-history-entry" key={payment.id || index}><b>{moneyStock(payment.amount)}</b><span>{payment.date ? new Date(payment.date).toLocaleString() : 'Date not recorded'}</span>{payment.note && <span>{payment.note}</span>}</div>)}</div></details>}</td><td>{p.ingredientName}</td><td>{p.purchaseQty} {p.purchaseUnit || 'packs'} × {p.conversion} {p.unit} = {p.baseQty} {p.unit}</td><td>{moneyStock(p.total)}</td><td>{moneyStock(p.paid)}</td><td><b>{moneyStock(Math.max(0,p.total-p.paid))}</b>{(p.paymentHistory||[]).length>0&&<details className="ff-payment-history"><summary>{p.paymentHistory.length} payment(s) · View history</summary><div>{p.paymentHistory.slice().sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).map((payment,index)=><div key={payment.id||index}><b>{moneyStock(payment.amount)}</b><span>{payment.date?new Date(payment.date).toLocaleString(): 'Date not recorded'}</span>{payment.note&&<span>{payment.note}</span>}</div>)}</div></details>}</td><td>{Number(p.total)>Number(p.paid)&&Number.isFinite(new Date(p.date).getTime()) ? Math.max(0,Math.floor((Date.now()-new Date(p.date).getTime())/86400000))+' days' : '—'}</td><td><div className="toolbar-right">{(p.paymentHistory || []).length > 0 && <button className="btn btn-secondary" onClick={() => setPurchaseHistoryView(p)}>Payment history</button>}{Number(p.total)>Number(p.paid)&&<button className="btn btn-primary" onClick={() => setPurchasePayment({id:p.id,supplier:p.supplier,amount:String(Number(p.total)-Number(p.paid)),note:''})}>Pay due</button>}</div></td></tr>)}</tbody></table>{!filteredPurchases.length && <div className="empty-state"><ShoppingCart size={28}/><b>{purchases.length ? 'No matching invoices' : 'No purchases recorded'}</b><span>{purchases.length ? 'Try a different search or payment filter.' : 'Record each supplier delivery to increase ingredient stock and track unpaid balances.'}</span></div>}</div>
    </div>}
    {tab === 'waste' && <div className="panel table-panel">
      <div className="panel-head"><div><h2>Ingredient waste register</h2><p>Each record reduces on-hand stock and captures reason, staff, quantity and estimated cost.</p></div><button className="btn btn-primary" onClick={() => setShowWaste(true)}><Plus size={16}/> Record waste</button></div>
      <div className="ff-stat-grid"><div className="ff-stat"><span>Total waste cost</span><b>{moneyStock(wasteRecords.reduce((n,w)=>n+Number(w.cost||0),0))}</b></div><div className="ff-stat"><span>Waste entries</span><b>{wasteRecords.length}</b></div><div className="ff-stat"><span>Quantity wasted</span><b>{wasteRecords.reduce((n,w)=>n+Number(w.qty||0),0).toLocaleString()}</b><small>Mixed units; see each record for unit</small></div></div>
      <div className="responsive-table"><table><thead><tr><th>DATE</th><th>INGREDIENT</th><th>QUANTITY</th><th>UNIT COST</th><th>WASTE COST</th><th>REASON</th><th>STAFF</th><th>NOTES</th></tr></thead><tbody>{wasteRecords.map(w=><tr key={w.id}><td>{new Date(w.date).toLocaleString()}</td><td><b>{w.ingredientName}</b></td><td>{w.qty} {w.unit}</td><td>{moneyStock(w.unitCost)}</td><td><b>{moneyStock(w.cost)}</b></td><td>{w.reason}</td><td>{w.staff}</td><td>{w.notes||'—'}</td></tr>)}</tbody></table>{!wasteRecords.length&&<div className="empty-state"><Trash2 size={28}/><b>No ingredient waste recorded</b><span>Record spoilage, prep loss, spills or other ingredient waste to track cost and stock impact.</span></div>}</div>
    </div>}
    {tab === 'reports' && <div className="panel table-panel">
      <div className="panel-head"><div><h2>Stock movement report</h2><p>Opening balances, purchases and recipe consumption</p></div><button className="btn btn-secondary" onClick={exportMovements}>Export filtered CSV</button></div>
      <div className="table-toolbar"><div className="toolbar-left"><input className="form-input" value={movementSearch} onChange={e => setMovementSearch(e.target.value)} placeholder="Search ingredient, reference, notes" aria-label="Search stock movements"/><select className="form-input" value={movementTypeFilter} onChange={e => setMovementTypeFilter(e.target.value)} aria-label="Filter stock movement type"><option value="all">All movement types</option>{[...new Set(movements.map(m => String(m.type || '').toLowerCase()).filter(Boolean))].sort().map(type => <option key={type} value={type}>{type}</option>)}</select><label className="ff-date-filter">From <input className="form-input" type="date" value={movementFromDate} max={movementToDate || undefined} onChange={e => setMovementFromDate(e.target.value)} aria-label="Movement start date"/></label><label className="ff-date-filter">To <input className="form-input" type="date" value={movementToDate} min={movementFromDate || undefined} onChange={e => setMovementToDate(e.target.value)} aria-label="Movement end date"/></label><button className="btn btn-secondary" onClick={() => { setMovementSearch(''); setMovementTypeFilter('all'); setMovementFromDate(''); setMovementToDate(''); }}>Clear filters</button></div><span className="ff-muted">{filteredMovements.length} of {movements.length} movements</span></div>
      <div className="responsive-table"><table><thead><tr><th>DATE</th><th>INGREDIENT</th><th>MOVEMENT</th><th>QUANTITY</th><th>REFERENCE</th><th>NOTES</th></tr></thead><tbody>{filteredMovements.map(m => <tr key={m.id}><td>{new Date(m.date).toLocaleString()}</td><td><b>{m.ingredientName}</b></td><td>{m.type}</td><td className={m.qty < 0 ? 'ff-negative' : 'ff-positive'}>{m.qty > 0 ? '+' : ''}{m.qty} {m.unit}</td><td>{m.reference}</td><td>{m.note}</td></tr>)}</tbody></table>{!filteredMovements.length && <div className="empty-state"><TrendingUp size={28}/><b>{movements.length ? 'No matching movements' : 'No stock movements yet'}</b><span>{movements.length ? 'Try a different search or movement type.' : 'Purchases and configured recipe sales will appear here.'}</span></div>}</div>
      <div className="ff-report-shortcuts">{['Low stock', 'Uncosted recipes', 'Supplier dues'].map(label => <button key={label} onClick={() => { if(label === 'Low stock') { setTab('ingredients'); setSearch(''); } else if(label === 'Uncosted recipes') setTab('recipes'); else setTab('purchases'); }}>{label} <TrendingDown size={15}/></button>)}</div>
    </div>}

    {showLibraryEditor && <div className="modal-backdrop"><form className="modal ff-wide-modal" onSubmit={e=>{e.preventDefault();if(!libraryDraft.name.trim()||!libraryDraft.ingredients.trim()||!libraryDraft.method.trim()){notify('Enter recipe name, ingredients and method');return;}const item={...libraryDraft,id:editingLibraryRecipe?.id||('custom-'+Date.now()),name:libraryDraft.name.trim(),notes:libraryDraft.notes.trim()};const next=editingLibraryRecipe?libraryRecipes.map(r=>r.id===editingLibraryRecipe.id?item:r):[item,...libraryRecipes];setLibraryRecipes(next);localStorage.setItem('malik-recipe-library',JSON.stringify(next));setShowLibraryEditor(false);setEditingLibraryRecipe(null);notify(editingLibraryRecipe?'Recipe updated':'Recipe added to library');}}><div className="modal-heading"><div><h2>{editingLibraryRecipe?'Edit library recipe':'Add your own recipe'}</h2><p>Write your own signature recipe, serving size and preparation steps.</p></div><button type="button" className="icon-btn" onClick={()=>setShowLibraryEditor(false)}><X size={16}/></button></div><label className="field-label">RECIPE NAME</label><input className="form-input" required value={libraryDraft.name} onChange={e=>setLibraryDraft({...libraryDraft,name:e.target.value})} placeholder="e.g. Malik Supreme Shawarma"/><div className="form-two"><div><label className="field-label">CATEGORY</label><select className="form-input" value={libraryDraft.category} onChange={e=>setLibraryDraft({...libraryDraft,category:e.target.value})}>{recipeLibraryCategories.map(c=><option key={c}>{c}</option>)}</select></div><div><label className="field-label">YIELD / PORTION</label><input className="form-input" required value={libraryDraft.servings} onChange={e=>setLibraryDraft({...libraryDraft,servings:e.target.value})} placeholder="1 wrap / 350 ml / 1 plate"/></div></div><label className="field-label">INGREDIENTS & QUANTITIES</label><textarea className="form-input" rows={4} required value={libraryDraft.ingredients} onChange={e=>setLibraryDraft({...libraryDraft,ingredients:e.target.value})} placeholder="Ingredient and exact quantity per serving"/><label className="field-label">PREPARATION METHOD</label><textarea className="form-input" rows={5} required value={libraryDraft.method} onChange={e=>setLibraryDraft({...libraryDraft,method:e.target.value})} placeholder="Step-by-step preparation instructions"/><label className="field-label">CHEF NOTES / ALLERGENS / STORAGE</label><textarea className="form-input" rows={2} value={libraryDraft.notes} onChange={e=>setLibraryDraft({...libraryDraft,notes:e.target.value})} placeholder="Optional notes, allergens and safe holding instructions"/><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={()=>setShowLibraryEditor(false)}>Cancel</button><button type="submit" className="btn btn-primary">Save recipe</button></div></form></div>}

    {showIngredient && <div className="modal-backdrop"><form className="modal" onSubmit={saveIngredient}><div className="modal-heading"><div><h2>{editingIngredient ? 'Edit ingredient' : 'Add ingredient'}</h2><p>Use one consistent base unit for every recipe.</p></div><button type="button" className="icon-btn" onClick={() => {setShowIngredient(false);setEditingIngredient(null);setIngredientDraft({name:'',sku:'',category:'Food',unit:'g',stock:'0',reorder:'0',cost:'0',supplier:''});}}><X size={16}/></button></div><label className="field-label">INGREDIENT NAME</label><input className="form-input" required autoFocus value={ingredientDraft.name} onChange={e => setIngredientDraft({...ingredientDraft,name:e.target.value})} placeholder="Chicken breast, burger bun, vanilla ice cream"/><div className="form-two"><div><label className="field-label">SKU / CODE</label><input className="form-input" value={ingredientDraft.sku} onChange={e => setIngredientDraft({...ingredientDraft,sku:e.target.value})}/></div><div><label className="field-label">CATEGORY</label><select className="form-input" value={ingredientDraft.category} onChange={e => setIngredientDraft({...ingredientDraft,category:e.target.value})}>{['Food','Meat','Dairy','Bakery','Sauce','Packaging','Beverage','Other'].map(x=><option key={x}>{x}</option>)}</select></div></div><div className="form-two"><div><label className="field-label">BASE UNIT</label><select className="form-input" value={ingredientDraft.unit} onChange={e => setIngredientDraft({...ingredientDraft,unit:e.target.value})}>{units.map(x=><option key={x}>{x}</option>)}</select></div><div><label className="field-label">OPENING STOCK ({ingredientDraft.unit})</label><input className="form-input" type="number" min="0" step="any" required value={ingredientDraft.stock} onChange={e => setIngredientDraft({...ingredientDraft,stock:e.target.value})}/></div></div><div className="form-two"><div><label className="field-label">COST PER BASE UNIT (Rs.)</label><input className="form-input" type="number" min="0" step="any" required value={ingredientDraft.cost} onChange={e => setIngredientDraft({...ingredientDraft,cost:e.target.value})}/></div><div><label className="field-label">REORDER LEVEL ({ingredientDraft.unit})</label><input className="form-input" type="number" min="0" step="any" value={ingredientDraft.reorder} onChange={e => setIngredientDraft({...ingredientDraft,reorder:e.target.value})}/></div></div><label className="field-label">PREFERRED SUPPLIER (OPTIONAL)</label><input className="form-input" value={ingredientDraft.supplier} onChange={e => setIngredientDraft({...ingredientDraft,supplier:e.target.value})}/><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowIngredient(false)}>Cancel</button><button className="btn btn-primary" type="submit">{editingIngredient ? 'Save changes' : 'Save ingredient'}</button></div></form></div>}
    {showRecipe && <div className="modal-backdrop"><form className="modal ff-wide-modal" onSubmit={saveRecipe}><div className="modal-heading"><div><h2>{editingRecipe ? 'Edit recipe & portion' : 'Recipe & portion setup'}</h2><p>Ingredient quantities are per one sold menu item.</p></div><button type="button" className="icon-btn" onClick={() => setShowRecipe(false)}><X size={16}/></button></div><label className="field-label">MENU ITEM</label><select className="form-input" required value={recipeDraft.productId} onChange={e => { const p = menuProducts.find(x => String(x.id) === e.target.value); setRecipeDraft(old => ({...old,productId:e.target.value,productName:p?.name || old.productName,variant:p?.variant || ''})); }}><option value="">Select existing POS item</option>{menuProducts.map(p => <option key={p.id} value={p.id}>{p.name}{p.variant ? ' · ' + p.variant : ''}</option>)}</select>{!menuProducts.length && <div className="ff-alert">Add menu items in the POS catalog first.</div>}<label className="field-label">VARIANT / PORTION (OPTIONAL)</label><input className="form-input" value={recipeDraft.variant} onChange={e => setRecipeDraft({...recipeDraft,variant:e.target.value})} placeholder="Small, Large, 1 scoop, 2 scoops — leave blank for all variants"/><div className="form-two"><div><label className="field-label">INGREDIENT</label><select className="form-input" value={recipeLine.ingredientId} onChange={e => setRecipeLine({...recipeLine,ingredientId:e.target.value})}><option value="">Select ingredient</option>{ingredients.map(x => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div><div><label className="field-label">QUANTITY PER ITEM ({ingredients.find(x => String(x.id) === String(recipeLine.ingredientId))?.unit || 'unit'})</label><input className="form-input" type="number" min="0.001" step="any" value={recipeLine.qty} onChange={e => setRecipeLine({...recipeLine,qty:e.target.value})} placeholder="e.g. 80 for 80g scoop"/></div></div><button type="button" className="btn btn-secondary" onClick={addRecipeLine}><Plus size={15}/> Add ingredient to recipe</button><div className="ff-recipe-editor">{recipeDraft.ingredients.map((x,i) => <div key={i}><span>{x.ingredientName}</span><b>{x.qty} {x.unit}</b><button type="button" className="icon-btn" onClick={() => setRecipeDraft(old => ({...old,ingredients:old.ingredients.filter((_,j) => j !== i)}))}><Trash2 size={13}/></button></div>)}</div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowRecipe(false)}>Cancel</button><button className="btn btn-primary" type="submit">{editingRecipe ? 'Save recipe changes' : 'Save recipe'}</button></div></form></div>}
    {purchaseHistoryView && <div className="modal-backdrop" onClick={() => setPurchaseHistoryView(null)}><div className="modal ff-wide-modal" onClick={e => e.stopPropagation()}><div className="modal-heading"><div><h2>Supplier payment history</h2><p>{purchaseHistoryView.supplier} · Invoice {purchaseHistoryView.invoice || purchaseHistoryView.id}</p></div><button type="button" className="icon-btn" onClick={() => setPurchaseHistoryView(null)}><X size={16}/></button></div><div className="ff-stat-grid"><div className="ff-stat"><span>Invoice total</span><b>{moneyStock(purchaseHistoryView.total)}</b></div><div className="ff-stat"><span>Paid to date</span><b>{moneyStock(purchaseHistoryView.paid)}</b></div><div className="ff-stat"><span>Remaining due</span><b>{moneyStock(Math.max(0, Number(purchaseHistoryView.total || 0) - Number(purchaseHistoryView.paid || 0)))}</b></div></div><div className="responsive-table"><table><thead><tr><th>PAYMENT REF</th><th>DATE</th><th>AMOUNT</th><th>NOTE / REFERENCE</th></tr></thead><tbody>{(purchaseHistoryView.paymentHistory || []).map((payment, index) => <tr key={payment.id || index}><td>{payment.id || '—'}</td><td>{payment.date ? new Date(payment.date).toLocaleString() : '—'}</td><td>{moneyStock(payment.amount)}</td><td>{payment.note || '—'}</td></tr>)}</tbody></table></div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setPurchaseHistoryView(null)}>Close</button></div></div></div>}
    {purchasePayment && <div className="modal-backdrop" onClick={() => setPurchasePayment(null)}><form className="modal" onClick={e => e.stopPropagation()} onSubmit={recordPurchasePayment}><div className="modal-heading"><div><h2>Pay supplier invoice</h2><p>{purchasePayment.supplier} · Ref {purchasePayment.id}</p></div><button type="button" className="icon-btn" onClick={() => setPurchasePayment(null)}><X size={16}/></button></div><label className="field-label">PAYMENT AMOUNT (Rs.)</label><input className="form-input" type="number" min="0.01" max={Math.max(0, Number(purchases.find(p => p.id === purchasePayment.id)?.total || 0) - Number(purchases.find(p => p.id === purchasePayment.id)?.paid || 0))} step="any" required value={purchasePayment.amount} onChange={e => setPurchasePayment({...purchasePayment,amount:e.target.value})}/><p className="settings-description">Outstanding before payment: <b>{moneyStock(Math.max(0, Number(purchases.find(p => p.id === purchasePayment.id)?.total || 0) - Number(purchases.find(p => p.id === purchasePayment.id)?.paid || 0)))}</b>. The payment cannot exceed this invoice balance.</p><label className="field-label">PAYMENT REFERENCE / NOTE</label><input className="form-input" value={purchasePayment.note} onChange={e => setPurchasePayment({...purchasePayment,note:e.target.value})} placeholder="Cash, bank transfer, receipt no…"/><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setPurchasePayment(null)}>Cancel</button><button type="submit" className="btn btn-primary">Confirm supplier payment</button></div></form></div>}
    {showWaste && <div className="modal-backdrop"><form className="modal ff-wide-modal" onSubmit={saveWaste}><div className="modal-heading"><div><h2>Record ingredient waste</h2><p>Creates a stock movement and calculates waste cost from the ingredient's current unit cost.</p></div><button type="button" className="icon-btn" onClick={() => setShowWaste(false)}><X size={16}/></button></div><label className="field-label">INGREDIENT</label><select className="form-input" required value={wasteDraft.ingredientId} onChange={e=>setWasteDraft({...wasteDraft,ingredientId:e.target.value})}><option value="">Select ingredient</option>{ingredients.map(i=><option key={i.id} value={i.id}>{i.name} · On hand {i.stock} {i.unit} · Cost {moneyStock(i.cost)}/{i.unit}</option>)}</select><div className="form-two"><div><label className="field-label">WASTE QUANTITY</label><input className="form-input" type="number" min="0.001" step="any" required value={wasteDraft.qty} onChange={e=>setWasteDraft({...wasteDraft,qty:e.target.value})}/></div><div><label className="field-label">REASON</label><select className="form-input" value={wasteDraft.reason} onChange={e=>setWasteDraft({...wasteDraft,reason:e.target.value})}><option>Preparation waste</option><option>Spoilage</option><option>Spillage</option><option>Overproduction</option><option>Expired ingredient</option><option>Quality issue</option><option>Other</option></select></div></div><label className="field-label">RESPONSIBLE STAFF</label><input className="form-input" required value={wasteDraft.staff} onChange={e=>setWasteDraft({...wasteDraft,staff:e.target.value})} placeholder="Staff name or ID"/><label className="field-label">NOTES / REFERENCE</label><textarea className="form-input" rows={2} value={wasteDraft.notes} onChange={e=>setWasteDraft({...wasteDraft,notes:e.target.value})} placeholder="Optional details, batch, order or incident reference"/>{wasteDraft.ingredientId&&<p className="settings-description">Estimated waste cost: {moneyStock((Number(wasteDraft.qty)||0)*Number(ingredients.find(i=>String(i.id)===String(wasteDraft.ingredientId))?.cost||0))}. On-hand stock: {ingredients.find(i=>String(i.id)===String(wasteDraft.ingredientId))?.stock||0} {ingredients.find(i=>String(i.id)===String(wasteDraft.ingredientId))?.unit||''}.</p>}<div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowWaste(false)}>Cancel</button><button type="submit" className="btn btn-primary">Post waste & stock movement</button></div></form></div>}
    {showPurchase && <div className="modal-backdrop"><form className="modal ff-wide-modal" onSubmit={savePurchase}><div className="modal-heading"><div><h2>Record ingredient purchase</h2><p>Convert supplier packaging into your stock base unit.</p></div><button type="button" className="icon-btn" onClick={() => setShowPurchase(false)}><X size={16}/></button></div><label className="field-label">SUPPLIER</label><input className="form-input" required value={purchaseDraft.supplier} onChange={e => setPurchaseDraft({...purchaseDraft,supplier:e.target.value})} placeholder="Supplier / vendor name"/><div className="form-two"><div><label className="field-label">PURCHASE PACK TYPE</label><input className="form-input" required value={purchaseDraft.purchaseUnit} onChange={e => setPurchaseDraft({...purchaseDraft,purchaseUnit:e.target.value})} placeholder="Carton, bag, tray, bottle"/></div><div><label className="field-label">INVOICE / BILL NUMBER</label><input className="form-input" value={purchaseDraft.invoice} onChange={e => setPurchaseDraft({...purchaseDraft,invoice:e.target.value})}/></div></div><div className="form-two"><div><label className="field-label">INGREDIENT</label><select className="form-input" required value={purchaseDraft.ingredientId} onChange={e => setPurchaseDraft({...purchaseDraft,ingredientId:e.target.value})}><option value="">Select ingredient</option>{ingredients.map(x => <option key={x.id} value={x.id}>{x.name} ({x.unit})</option>)}</select></div><div><label className="field-label">EXPIRY DATE (OPTIONAL)</label><input className="form-input" type="date" value={purchaseDraft.expiryDate} onChange={e => setPurchaseDraft({...purchaseDraft,expiryDate:e.target.value})} /></div></div><div className="form-two"><div><label className="field-label">PURCHASE QUANTITY (PACKS)</label><input className="form-input" type="number" min="0.001" step="any" required value={purchaseDraft.purchaseQty} onChange={e => setPurchaseDraft({...purchaseDraft,purchaseQty:e.target.value})} placeholder="10"/></div><div><label className="field-label">BASE UNITS PER PACK ({ingredients.find(x => String(x.id) === String(purchaseDraft.ingredientId))?.unit || "unit"})</label><input className="form-input" type="number" min="0.001" step="any" required value={purchaseDraft.conversion} onChange={e => setPurchaseDraft({...purchaseDraft,conversion:e.target.value})} placeholder="e.g. 10 kg per carton"/></div></div><div className="form-two"><div><label className="field-label">COST PER PACK (Rs.)</label><input className="form-input" type="number" min="0" step="any" required value={purchaseDraft.unitCost} onChange={e => setPurchaseDraft({...purchaseDraft,unitCost:e.target.value})}/></div><div><label className="field-label">AMOUNT PAID (Rs.)</label><input className="form-input" type="number" min="0" step="any" value={purchaseDraft.paid} onChange={e => setPurchaseDraft({...purchaseDraft,paid:e.target.value})} placeholder="0 if on credit"/></div></div><label className="field-label">NOTES</label><input className="form-input" value={purchaseDraft.notes} onChange={e => setPurchaseDraft({...purchaseDraft,notes:e.target.value})} placeholder="Optional delivery notes"/><div className="ff-purchase-preview">Received: <b>{((Number(purchaseDraft.purchaseQty)||0)*(Number(purchaseDraft.conversion)||0)).toLocaleString()} {ingredients.find(x => String(x.id) === String(purchaseDraft.ingredientId))?.unit || 'base units'}</b> · Total: <b>{moneyStock((Number(purchaseDraft.purchaseQty)||0)*(Number(purchaseDraft.unitCost)||0))}</b></div><div className="modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setShowPurchase(false)}>Cancel</button><button className="btn btn-primary" type="submit">Post purchase & update stock</button></div></form></div>}
  </div>;
}
