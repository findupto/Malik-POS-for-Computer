import React, { useMemo, useState } from 'react';
import { BarChart3, Users, Package, BriefcaseBusiness, CalendarDays, Search, TrendingUp, CircleDollarSign, Filter, ChevronRight } from 'lucide-react';

const money = n => 'Rs. ' + new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Number(n) || 0);
const dateOf = value => String(value || '').slice(0, 10);
const orderStatus = order => { const status=String(order?.status||'completed').toLowerCase(); if(/cancel|void/.test(status))return 'Cancelled'; if(/waste|spoiled|damaged|write.?off/.test(status))return 'Waste'; if(/pending|hold|draft|unpaid/.test(status))return 'Pending'; if(/refund|return/.test(status))return 'Refunded'; return 'Completed'; };
const completed = order => orderStatus(order)==='Completed';
const totalOf = order => Math.max(0, Number(order.total || 0) - Number(order.refundedTotal || 0));
const timestampOf = value => value?.paidAt || value?.completedAt || value?.createdAt || value?.date || value?.timestamp || value?.checkIn || '';
const itemQuantity = item => Math.max(0,Number(item?.qty ?? item?.quantity)||0);
const itemSale = item => Math.max(0,Number(item?.price ?? item?.unitPrice ?? item?.salePrice)||0)*itemQuantity(item);
const safeName = value => String(value || 'Unknown').trim() || 'Unknown';
const getItemCost = item => {
  const value = item.unitCost ?? item.costPrice ?? item.cost ?? item.purchasePrice;
  return Number.isFinite(Number(value)) && value !== '' ? Number(value) : null;
};
const panel = { background: 'var(--panel,#fff)', border: '1px solid var(--border,#e5e7eb)', borderRadius: 16, padding: 18, minWidth: 0 };
const field = { width: '100%', minWidth: 0, padding: '10px 12px', borderRadius: 10, border: '1px solid var(--border,#d1d5db)', background: 'var(--input-bg,#fff)', color: 'inherit' };
const smallLabel = { display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '.07em', marginBottom: 6, opacity: .72 };

function ClickChart({ data, mode, setMode, onSelect, selected }) {
  const max = Math.max(1, ...data.map(d => Number(d.value) || 0));
  const width = Math.max(340, data.length * 58);
  const height = 210;
  const pad = { top: 14, right: 10, bottom: 48, left: 12 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const gap = 8;
  const barW = Math.max(12, (innerW - gap * Math.max(0, data.length - 1)) / Math.max(1, data.length));
  return <div>
    <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
      {['bar','line'].map(value => <button key={value} className={'btn '+(mode===value?'btn-primary':'btn-secondary')} onClick={()=>setMode(value)}>{value==='bar'?'Bar chart':'Line chart'}</button>)}
      <span style={{fontSize:12,opacity:.7,alignSelf:'center'}}>Tap a point/bar to filter the records below.</span>
    </div>
    <div style={{overflowX:'auto'}}>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Clickable business analytics chart" style={{display:'block',width:'100%',minWidth:Math.min(width,340),maxHeight:260}}>
        {[0, .25, .5, .75, 1].map(t => <g key={t}><line x1={pad.left} y1={pad.top+innerH*t} x2={width-pad.right} y2={pad.top+innerH*t} stroke="currentColor" opacity=".12"/><text x={pad.left} y={pad.top+innerH*t-3} fontSize="9" fill="currentColor" opacity=".65">{Math.round(max*(1-t)).toLocaleString('en-PK')}</text></g>)}
        {mode==='line' && data.length>1 && <polyline fill="none" stroke="var(--accent,#4f46e5)" strokeWidth="2.5" points={data.map((d,i)=>`${pad.left+i*(barW+gap)+barW/2},${pad.top+innerH-(Number(d.value)||0)/max*innerH}`).join(' ')}/>}
        {data.map((d,i)=>{const v=Math.max(0,Number(d.value)||0);const h=v/max*innerH;const x=pad.left+i*(barW+gap);const y=pad.top+innerH-h;const active=selected===d.key;return <g key={d.key} onClick={()=>onSelect(d.key)} style={{cursor:'pointer'}} tabIndex="0" role="button" aria-label={`Filter by ${d.label}: ${v}`} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')onSelect(d.key)}}>
          {mode==='bar'&&<rect x={x} y={y} width={barW} height={Math.max(1,h)} rx="4" fill={active?'var(--accent-strong,#312e81)':'var(--accent,#6366f1)'} opacity={active?1:.82}/>}
          {mode==='line'&&<circle cx={x+barW/2} cy={y} r={active?5:3.5} fill={active?'var(--accent-strong,#312e81)':'var(--accent,#6366f1)'} stroke="var(--panel,#fff)" strokeWidth="1.5"/>}
          <text x={x+barW/2} y={height-27} textAnchor="middle" fontSize="9" fill="currentColor" opacity=".85">{String(d.label).slice(0,10)}</text>
          <text x={x+barW/2} y={height-14} textAnchor="middle" fontSize="9" fill="currentColor" opacity=".65">{v.toLocaleString('en-PK',{notation:'compact',maximumFractionDigits:1})}</text>
          <rect x={x} y={pad.top} width={barW} height={innerH+4} fill="transparent"/>
        </g>})}
      </svg>
    </div>
    {!data.length&&<p>No chart data for this filter.</p>}
  </div>;
}

export default function BusinessAnalytics({ orders=[], products=[], customers=[], suppliers=[], staff=[], staffPayments=[], attendance=[], ledgerPayments=[], expenses=[], stockPurchases=[], wasteRecords=[], inventoryMovements=[], canManageStaff=false }) {
  const [section,setSection] = useState('Products');
  const [from,setFrom] = useState('');
  const [to,setTo] = useState('');
  const [search,setSearch] = useState('');
  const [entityId,setEntityId] = useState('all');
  const [chartMode,setChartMode] = useState('bar');
  const [chartView,setChartView] = useState('compare');
  const [statusFilter,setStatusFilter] = useState('all');
  const [selectedBucket,setSelectedBucket] = useState('');
  const [selectedRecord,setSelectedRecord] = useState('');
  const inRange = value => { const date=dateOf(value); return (!from || (date && date>=from)) && (!to || (date && date<=to)); };
  const rangeOrders = useMemo(()=>orders.filter(o=>inRange(timestampOf(o))),[orders,from,to]);
  const filteredOrders = useMemo(()=>statusFilter==='all'?rangeOrders:rangeOrders.filter(o=>orderStatus(o).toLowerCase()===statusFilter),[rangeOrders,statusFilter]);
  const sales = useMemo(()=>filteredOrders.filter(completed),[filteredOrders]);
  const visibleOrders = useMemo(()=>filteredOrders.filter(o=>!search||[o.id,o.customer,o.payment,o.status,(o.items||[]).map(i=>i.name+' '+i.sku).join(' ')].join(' ').toLowerCase().includes(search.toLowerCase())),[filteredOrders,search]);
  const orderStatusTotals = useMemo(()=>rangeOrders.reduce((out,o)=>{const status=orderStatus(o);out[status]=(out[status]||0)+1;out[status+'Value']=(out[status+'Value']||0)+(Number(o.total)||0);return out;},{ }),[rangeOrders]);
  const catalogCost = item => { const p=products.find(p=>String(p.id)===String(item?.productId??item?.id??'') || (item?.sku&&String(p.sku)===String(item.sku)) || (item?.name&&String(p.name)===String(item.name))); const cost=getItemCost(item); return cost===null&&p?getItemCost(p):cost; };
  const itemCostTotal = item => {const cost=catalogCost(item);return cost===null?null:cost*itemQuantity(item);};
  const productRows = useMemo(()=>{
    const map=new Map();
    const ensure=(item)=>{const key=String(item.productId??item.id??item.sku??(item.name+'|'+(item.variant||'')));const row=map.get(key)||{key,name:safeName(item.name),variant:item.variant||'',sku:item.sku||'',qty:0,revenue:0,cost:0,costKnown:true,orders:0,days:new Set(),transactions:[],cancelledQty:0,wasteQty:0,pendingQty:0};map.set(key,row);return row;};
    for(const order of filteredOrders) { const items=order.items||[];const grossSubtotal=items.reduce((n,it)=>n+itemSale(it),0);const discount=Math.min(grossSubtotal,Math.max(0,Number(order.discount)||0));for(const item of items) {
      const row=ensure(item);const qty=itemQuantity(item);const status=orderStatus(order);const grossSale=itemSale(item);const discountAllocated=grossSubtotal>0?discount*(grossSale/grossSubtotal):0;const sale=Math.max(0,grossSale-discountAllocated);const costUnit=catalogCost(item);const cost=costUnit===null?null:costUnit*qty;
      if(status==='Completed'){row.qty+=qty;row.revenue+=sale;if(cost===null)row.costKnown=false;else row.cost+=cost;row.orders+=1;row.days.add(dateOf(timestampOf(order)));}
      if(status==='Cancelled')row.cancelledQty+=qty;if(status==='Waste')row.wasteQty+=qty;if(status==='Pending')row.pendingQty+=qty;
      row.transactions.push({order,item,amount:sale,grossAmount:grossSale,discountAllocated,cost,status,profit:status==='Completed'&&cost!==null?sale-cost:null});
    }}
    return [...map.values()].map(row=>({...row,profit:row.costKnown?row.revenue-row.cost:null})).sort((a,b)=>b.qty-a.qty);
  },[filteredOrders,products]);
  const productRowsWithCatalog = useMemo(()=>{const catalog=products.map(p=>{const row=productRows.find(x=>String(x.key)===String(p.id)||String(x.sku)===String(p.sku)||x.name===p.name);const currentCost=getItemCost(p);const recordedWaste=wasteRecords.filter(w=>String(w.productId??w.product_id??'')===String(p.id)||(w.sku&&String(w.sku)===String(p.sku))||safeName(w.productName??w.product_name??w.name)===safeName(p.name)).reduce((n,w)=>n+Math.max(0,Number(w.quantity??w.qty)||0),0);return {...(row||{key:String(p.id),name:p.name,variant:p.variant||'',sku:p.sku||'',qty:0,revenue:0,cost:0,costKnown:currentCost!==null,profit:0,orders:0,days:new Set(),transactions:[],cancelledQty:0,wasteQty:0,pendingQty:0}),key:String(p.id??row?.key),name:p.name||row?.name,sku:p.sku||row?.sku||'',stock:Number(p.stock??p.quantity??p.remainingStock)||0,unitCost:currentCost,minStock:Number(p.minStock??p.minimumStock??p.reorderLevel)||0,stockValue:currentCost===null?null:currentCost*Math.max(0,Number(p.stock??p.quantity??p.remainingStock)||0),wasteQty:(row?.wasteQty||0)+recordedWaste,profit:row?row.profit:null}});const known=new Set(catalog.flatMap(p=>[String(p.key),String(p.sku||''),safeName(p.name).toLowerCase()]));const missing=productRows.filter(r=>!known.has(String(r.key))&&!known.has(String(r.sku||''))&&!known.has(safeName(r.name).toLowerCase()));return [...catalog,...missing]},[products,productRows,wasteRecords]);
  const customerRows = useMemo(()=>customers.map(c=>{const history=filteredOrders.filter(o=>safeName(o.customer)===safeName(c.name));const tx=history.filter(completed);const paid=tx.reduce((n,o)=>n+totalOf(o),0);const payments=ledgerPayments.filter(p=>String(p.customer||p.entityName||'')===String(c.name));return {...c,key:String(c.id??c.name),transactions:history,total:paid,visits:tx.length,avg:tx.length?paid/tx.length:0,payments,due:Number(c.dueBalance||c.due||0)}}).sort((a,b)=>b.total-a.total),[customers,sales,filteredOrders,ledgerPayments]);
  const supplierRows = useMemo(()=>suppliers.map(s=>{const name=safeName(s.name);const allPurchases=stockPurchases.filter(p=>safeName(p.supplier)===name);const purchases=allPurchases.filter(p=>inRange(p.date||p.createdAt));const paid=purchases.reduce((n,p)=>n+Math.max(0,Number(p.paid)||0),0);const spend=purchases.reduce((n,p)=>n+Math.max(0,Number(p.total)||0),0);const payments=ledgerPayments.filter(p=>String(p.supplier||p.entityName||'')===name&&inRange(p.date||p.createdAt));return {...s,key:String(s.id??name),transactions:purchases,total:spend,paid,due:allPurchases.reduce((n,p)=>n+Math.max(0,Number(p.total||0)-Number(p.paid||0)),0)+Math.max(0,Number(s.due)||0),payments}}).sort((a,b)=>b.total-a.total),[suppliers,stockPurchases,ledgerPayments,from,to]);
  const staffRows = useMemo(()=>staff.map(person=>{const id=String(person.id??person.username??person.name);const payments=staffPayments.filter(p=>String(p.staffId??p.employeeId??p.staff_id??p.name??'')===id||String(p.staffName??p.employeeName??'')===String(person.name));const time=attendance.filter(a=>String(a.staffId??a.employeeId??a.staff_id??'')===id||String(a.staffName??a.name??'')===String(person.name)).filter(a=>inRange(a.date||a.checkIn||a.createdAt));const paid=payments.filter(p=>inRange(p.date||p.createdAt)).reduce((n,p)=>n+Math.max(0,Number(p.amount)||0),0);const bonuses=payments.filter(p=>inRange(p.date||p.createdAt)&&/bonus/i.test(String(p.type||p.kind||p.category||''))).reduce((n,p)=>n+Math.max(0,Number(p.amount)||0),0);const advances=payments.filter(p=>inRange(p.date||p.createdAt)&&/advance/i.test(String(p.type||p.kind||p.category||''))).reduce((n,p)=>n+Math.max(0,Number(p.amount)||0),0);return {...person,key:id,payments:payments.filter(p=>inRange(p.date||p.createdAt)),attendance:time,paid,bonuses,advances,due:Math.max(0,Number(person.salary||person.monthlySalary||0)-paid)}}).sort((a,b)=>b.paid-a.paid),[staff,staffPayments,attendance,from,to]);
  const filteredEntities = useMemo(()=>{
    const list=section==='Products'?productRowsWithCatalog:section==='Customers'?customerRows:section==='Suppliers'?supplierRows:staffRows;
    const inSelectedMonth=row=>{if(chartView!=='monthly'||!selectedBucket)return true;const events=section==='Staff'?[...(row.payments||[]),...(row.attendance||[])]:row.transactions||[];return events.some(tx=>dateOf(tx.order?.date||tx.date||tx.createdAt||tx.checkIn).startsWith(selectedBucket));};
    return list.filter(row=>(entityId==='all'||String(row.key)===entityId)&&(!search||[row.name,row.sku,row.phone,row.username,row.role,(row.transactions||[]).map(tx=>[tx.id,tx.order?.id,tx.status,tx.customer,tx.payment,tx.note,(tx.items||[]).map(i=>i.name+' '+i.sku).join(' ')].join(' ')).join(' ')].join(' ').toLowerCase().includes(search.toLowerCase()))&&inSelectedMonth(row));
  },[section,productRowsWithCatalog,customerRows,supplierRows,staffRows,entityId,search,chartView,selectedBucket]);
  const selected = filteredEntities.find(row=>String(row.key)===String(selectedRecord)) || filteredEntities[0] || null;
  const chartData = useMemo(()=>{
    if(chartView==='monthly') {
      const map=new Map();
      const add=(date,value)=>{const month=dateOf(date).slice(0,7);if(!/^\d{4}-\d{2}$/.test(month))return;const row=map.get(month)||{key:month,label:month,value:0};row.value+=Number(value)||0;map.set(month,row)};
      if(section==='Products') {
        const chosen=entityId==='all'?null:productRowsWithCatalog.find(r=>String(r.key)===String(entityId));
        for(const order of sales)for(const item of order.items||[])if(!chosen||String(item.productId??item.id??item.sku??(item.name+'|'+(item.variant||'')))===String(chosen.key)||String(item.sku||'')===String(chosen.sku||'')||String(item.name||'')===String(chosen.name||''))add(order.date,Math.max(0,Number(item.qty)||0));
      } else if(section==='Customers') {
        const chosen=entityId==='all'?null:customerRows.find(r=>String(r.key)===String(entityId));
        for(const order of sales)if(!chosen||safeName(order.customer)===safeName(chosen.name))add(order.date,totalOf(order));
      } else if(section==='Suppliers') {
        const chosen=entityId==='all'?null:supplierRows.find(r=>String(r.key)===String(entityId));
        for(const purchase of stockPurchases)if(inRange(purchase.date||purchase.createdAt)&&(!chosen||safeName(purchase.supplier)===safeName(chosen.name)))add(purchase.date||purchase.createdAt,Number(purchase.total)||0);
      } else {
        const chosen=entityId==='all'?null:staffRows.find(r=>String(r.key)===String(entityId));
        for(const payment of staffPayments)if(inRange(payment.date||payment.createdAt)&&(!chosen||String(payment.staffName??payment.employeeName??payment.name??'')===String(chosen.name)||String(payment.staffId??payment.employeeId??payment.staff_id??'')===String(chosen.key)))add(payment.date||payment.createdAt,Number(payment.amount)||0);
      }
      return [...map.values()].sort((a,b)=>a.key.localeCompare(b.key));
    }
    if(section==='Products') return filteredEntities.slice(0,12).map(r=>({key:r.key,label:r.name,value:r.qty}));
    if(section==='Customers') return filteredEntities.slice(0,12).map(r=>({key:r.key,label:r.name,value:r.total}));
    if(section==='Suppliers') return filteredEntities.slice(0,12).map(r=>({key:r.key,label:r.name,value:r.total}));
    return filteredEntities.slice(0,12).map(r=>({key:r.key,label:r.name,value:r.paid}));
  },[chartView,section,filteredEntities,entityId,sales,productRowsWithCatalog,customerRows,supplierRows,staffRows,stockPurchases,staffPayments,from,to]);
  const selectedTransactions = selected ? section==='Products' ? [...(selected.transactions||[]),...wasteRecords.filter(w=>String(w.productId??w.product_id??'')===String(selected.key)||(w.sku&&String(w.sku)===String(selected.sku))||safeName(w.productName??w.product_name??w.name)===safeName(selected.name)).map(w=>({...w,type:'Stock waste',status:'Waste',date:w.date||w.createdAt,cost:Number(w.cost)||null,amount:null})),...inventoryMovements.filter(m=>String(m.product_id??m.productId??'')===String(selected.key)||(m.sku&&String(m.sku)===String(selected.sku))||safeName(m.product_name??m.productName??m.name)===safeName(selected.name)).map(m=>({...m,type:m.reason||m.type||'Stock movement',date:m.occurred_at||m.date||m.createdAt,amount:m.cost??m.value??null,status:m.reason||m.type||'Stock movement'}))] : section==='Customers' ? [...(selected.transactions||[]),...(selected.payments||[])] : section==='Suppliers' ? [...(selected.transactions||[]),...(selected.payments||[])] : [...(selected.payments||[]),...(selected.attendance||[]).map(a=>({...a,type:'Attendance'}))] : [];
  const selectedTxFiltered = selectedTransactions.filter(tx=>{const order=tx.order||tx;const date=timestampOf(order)||timestampOf(tx);const txDate=dateOf(date);return inRange(date)&&(!selectedBucket || String(order.id??tx.id??tx.date??'')===selectedBucket || txDate.startsWith(selectedBucket));});
  const metric = section==='Products' ? [
    ['Units sold',filteredEntities.reduce((n,r)=>n+r.qty,0)],
    ['Sales revenue',money(filteredEntities.reduce((n,r)=>n+r.revenue,0))],
    ['Estimated profit',filteredEntities.every(r=>r.profit!==null)?money(filteredEntities.reduce((n,r)=>n+r.profit,0)):'Cost data needed'],
    ['Active products',filteredEntities.filter(r=>r.qty>0).length]
  ] : section==='Customers' ? [
    ['Customer sales',money(filteredEntities.reduce((n,r)=>n+r.total,0))],
    ['Transactions',filteredEntities.reduce((n,r)=>n+r.visits,0)],
    ['Outstanding dues',money(filteredEntities.reduce((n,r)=>n+r.due,0))],
    ['Customers',filteredEntities.length]
  ] : section==='Suppliers' ? [
    ['Purchases',money(filteredEntities.reduce((n,r)=>n+r.total,0))],
    ['Paid to suppliers',money(filteredEntities.reduce((n,r)=>n+r.paid,0))],
    ['Outstanding due',money(filteredEntities.reduce((n,r)=>n+r.due,0))],
    ['Suppliers',filteredEntities.length]
  ] : [
    ['Staff working',staff.filter(s=>s.active!==false).length],
    ['Payments recorded',money(filteredEntities.reduce((n,r)=>n+r.paid,0))],
    ['Bonuses',money(filteredEntities.reduce((n,r)=>n+r.bonuses,0))],
    ['Advances',money(filteredEntities.reduce((n,r)=>n+r.advances,0))]
  ];
  const exportCsv = () => {
    const rows=section==='Products'? [['Product','SKU','Units sold','Revenue','Estimated profit'],...filteredEntities.map(r=>[r.name,r.sku,r.qty,r.revenue,r.profit??'Cost data needed'])] : section==='Customers'?[['Customer','Phone','Transactions','Sales','Due'],...filteredEntities.map(r=>[r.name,r.phone,r.visits,r.total,r.due])] : section==='Suppliers'?[['Supplier','Phone','Purchases','Paid','Due'],...filteredEntities.map(r=>[r.name,r.phone,r.total,r.paid,r.due])] : [['Staff','Role','Payments','Bonus','Advance','Estimated remaining'],...filteredEntities.map(r=>[r.name,r.role,r.paid,r.bonuses,r.advances,r.due])];
    const csv='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='malik-pos-'+section.toLowerCase()+'-analytics.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const sectionButtons=['Products','Customers','Suppliers',...(canManageStaff?['Staff']:[])];
  const overallSales=sales.reduce((n,o)=>n+totalOf(o),0);
  const overallExpenses=expenses.filter(e=>inRange(e.date)).reduce((n,e)=>n+Math.max(0,Number(e.amount)||0),0);
  const allItemCosts=sales.flatMap(o=>(o.items||[]).map(item=>({item,qty:itemQuantity(item)})));
  const orderCosts=sales.map(order=>{if(order.ingredientCostEstimate!==undefined&&Number.isFinite(Number(order.ingredientCostEstimate)))return {known:true,cost:Math.max(0,Number(order.ingredientCostEstimate)||0),sale:totalOf(order)};const items=order.items||[];const costs=items.map(item=>{const unit=catalogCost(item);return unit===null?null:unit*itemQuantity(item)});return {known:costs.length>0&&costs.every(v=>v!==null),cost:costs.reduce((n,v)=>n+(v||0),0),sale:totalOf(order)}});
  const costDataComplete=orderCosts.length>0&&orderCosts.every(x=>x.known);
  const estimatedGrossProfit=costDataComplete?orderCosts.reduce((n,x)=>n+x.sale-x.cost,0):null;
  const recordedWasteCost=wasteRecords.filter(w=>inRange(w.date||w.createdAt)).reduce((n,w)=>n+Math.max(0,Number(w.cost)||0),0);
  const lossMakingProducts=productRowsWithCatalog.filter(p=>p.profit!==null&&p.profit<0).length;
  return <div style={{display:'grid',gap:16}}>
    <div style={{...panel,background:'linear-gradient(135deg,var(--panel,#fff),var(--surface,#f8fafc))'}}>
      <div style={{display:'flex',gap:12,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap'}}>
        <div><div style={{fontSize:11,fontWeight:800,letterSpacing:'.1em',opacity:.65}}>BUSINESS INTELLIGENCE</div><h2 style={{margin:'5px 0'}}>Detailed analytics</h2><p style={{margin:0,opacity:.72}}>Filter by date, search every record, click a chart to open a profile and transaction history.</p></div>
        <button className="btn btn-secondary" onClick={exportCsv}>Export filtered CSV</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:16}}>
        <div><label style={smallLabel}>FROM DATE</label><input style={field} type="date" value={from} onChange={e=>{setFrom(e.target.value);setSelectedBucket('')}}/></div>
        <div><label style={smallLabel}>TO DATE</label><input style={field} type="date" value={to} onChange={e=>{setTo(e.target.value);setSelectedBucket('')}}/></div>
        <div><label style={smallLabel}>TRANSACTION STATUS</label><select style={field} value={statusFilter} onChange={e=>{setStatusFilter(e.target.value);setSelectedBucket('')}}><option value="all">All statuses</option><option value="completed">Completed / sale</option><option value="pending">Pending</option><option value="cancelled">Cancelled</option><option value="waste">Waste</option><option value="refunded">Refunded / returned</option></select></div>
        <div><label style={smallLabel}>SEARCH ALL RECORDS</label><div style={{position:'relative'}}><Search size={15} style={{position:'absolute',left:10,top:12,opacity:.55}}/><input style={{...field,paddingLeft:32}} value={search} onChange={e=>{setSearch(e.target.value);setSelectedRecord('')}} placeholder="Name, SKU, transaction…"/></div></div>
        <div><label style={smallLabel}>SELECT RECORD</label><select style={field} value={entityId} onChange={e=>{setEntityId(e.target.value);setSelectedRecord('');setSelectedBucket('')}}><option value="all">All records</option>{(section==='Products'?productRowsWithCatalog:section==='Customers'?customerRows:section==='Suppliers'?supplierRows:staffRows).map(r=><option key={r.key} value={r.key}>{r.name}</option>)}</select></div>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:14}}>{sectionButtons.map(s=><button key={s} className={'btn '+(section===s?'btn-primary':'btn-secondary')} onClick={()=>{setSection(s);setEntityId('all');setSelectedRecord('');setSelectedBucket('')}}>{s==='Products'?<Package size={15}/>:s==='Staff'?<Users size={15}/>:s==='Suppliers'?<BriefcaseBusiness size={15}/>:<Users size={15}/>} {s}</button>)}</div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
      <div style={panel}><div style={{display:'flex',alignItems:'center',gap:8,opacity:.72,fontSize:12}}><CircleDollarSign size={16}/> Total net sales</div><div style={{fontSize:22,fontWeight:800,marginTop:8}}>{money(overallSales)}</div><small>{sales.length} completed transactions</small></div>
      <div style={panel}><div style={{display:'flex',alignItems:'center',gap:8,opacity:.72,fontSize:12}}><TrendingUp size={16}/> Recorded expenses</div><div style={{fontSize:22,fontWeight:800,marginTop:8}}>{money(overallExpenses)}</div><small>Selected date range</small></div>
      <div style={panel}><div style={{display:'flex',alignItems:'center',gap:8,opacity:.72,fontSize:12}}><BarChart3 size={16}/> Gross profit estimate</div><div style={{fontSize:22,fontWeight:800,marginTop:8}}>{estimatedGrossProfit===null?'Cost data needed':money(estimatedGrossProfit)}</div><small>{estimatedGrossProfit===null?'Record unit costs on sold items':'Before operating expenses'}</small></div>
      <div style={panel}><div style={{fontSize:12,opacity:.72}}>Recorded stock-waste cost</div><div style={{fontSize:22,fontWeight:800,marginTop:8}}>{money(recordedWasteCost)}</div><small>{wasteRecords.filter(w=>inRange(w.date||w.createdAt)).length} recorded waste entries</small></div>
      <div style={panel}><div style={{fontSize:12,opacity:.72}}>Loss-making products</div><div style={{fontSize:22,fontWeight:800,marginTop:8}}>{lossMakingProducts}</div><small>Only products with known costs</small></div>
      {metric.map(([label,value],i)=><div key={label} style={panel}><div style={{display:'flex',alignItems:'center',gap:8,opacity:.72,fontSize:12}}>{i===0?<TrendingUp size={16}/>:i===1?<CircleDollarSign size={16}/>:i===2?<Filter size={16}/>:<BarChart3 size={16}/>} {label}</div><div style={{fontSize:22,fontWeight:800,marginTop:8,overflowWrap:'anywhere'}}>{value}</div></div>)}
      {['Completed','Pending','Cancelled','Waste','Refunded'].map(status=><div key={status} style={panel}><div style={{fontSize:12,opacity:.72}}>{status} orders</div><div style={{fontSize:22,fontWeight:800,marginTop:8}}>{orderStatusTotals[status]||0}</div><small>{money(orderStatusTotals[status+'Value']||0)} order value</small></div>)}
    </div>
    <div style={{...panel}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginBottom:12}}><div><h3 style={{margin:'0 0 4px'}}>{section} {chartView==='monthly'?'monthly trend':'comparison'}</h3><p style={{margin:0,opacity:.7,fontSize:13}}>{chartView==='monthly'?(section==='Products'?'Units sold per month':section==='Customers'?'Sales per month':section==='Suppliers'?'Purchases per month':'Staff payments per month'):(section==='Products'?'Units sold by product':section==='Customers'?'Sales by customer':section==='Suppliers'?'Purchases by supplier':'Recorded staff payments by person')}</p></div><span style={{fontSize:12,opacity:.65}}>{chartData.length} chart points</span></div>
      <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:10}}><button className={'btn '+(chartView==='compare'?'btn-primary':'btn-secondary')} onClick={()=>{setChartView('compare');setSelectedBucket('')}}>Compare records</button><button className={'btn '+(chartView==='monthly'?'btn-primary':'btn-secondary')} onClick={()=>{setChartView('monthly');setSelectedBucket('')}}>Monthly trend</button></div>
      <ClickChart data={chartData} mode={chartMode} setMode={setChartMode} selected={chartView==='monthly'?selectedBucket:(entityId!=='all'?entityId:selectedBucket)} onSelect={key=>{if(chartView==='monthly'){setSelectedBucket(key)}else{setEntityId(key);setSelectedRecord(key);setSelectedBucket('')}}}/>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>{chartData.map(row=><button key={row.key} className={'btn '+((chartView==='monthly'?String(selectedBucket)===String(row.key):String(entityId)===String(row.key))?'btn-primary':'btn-secondary')} onClick={()=>{if(chartView==='monthly'){setSelectedBucket(String(row.key))}else{setEntityId(String(row.key));setSelectedRecord(String(row.key));setSelectedBucket('')}}} style={{fontSize:12}}>{row.label} · {(section==='Products'&&chartView!=='monthly')||section==='Products'?row.value.toLocaleString():money(row.value)}</button>)}</div>
    </div>
    <div style={{...panel}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><div><h3 style={{margin:'0 0 4px'}}>{section} records</h3><p style={{margin:0,opacity:.7,fontSize:13}}>Select a row to open its detailed history.</p></div><span style={{fontSize:12,opacity:.65}}>{filteredEntities.length} records</span></div>
      <div style={{overflowX:'auto',marginTop:12}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead><tr>{(section==='Products'?['Product','SKU','Sold','Sale revenue','Cost','Profit / loss','Stock left','Waste qty','Cancelled qty']:section==='Customers'?['Customer','Phone','Transactions','Sales','Due']:section==='Suppliers'?['Supplier','Phone','Purchases','Paid','Due']:['Staff member','Role','Payments','Bonus','Advance']).map(h=><th key={h} style={{textAlign:'left',padding:'10px 8px',borderBottom:'1px solid var(--border,#e5e7eb)',whiteSpace:'nowrap'}}>{h}</th>)}<th style={{padding:'10px 8px',borderBottom:'1px solid var(--border,#e5e7eb)'}}>History</th></tr></thead><tbody>{filteredEntities.map(row=><tr key={row.key} onClick={()=>{setSelectedRecord(String(row.key));setEntityId(String(row.key));setSelectedBucket('')}} style={{cursor:'pointer',background:String(selected?.key)===String(row.key)?'var(--surface,#f3f4f6)':'transparent'}}>{section==='Products'?<><td style={{padding:9}}><b>{row.name}</b>{row.variant&&<small style={{display:'block',opacity:.7}}>{row.variant}</small>}</td><td style={{padding:9}}>{row.sku||'—'}</td><td style={{padding:9}}>{row.qty}</td><td style={{padding:9}}>{money(row.revenue)}</td><td style={{padding:9}}>{row.costKnown?money(row.cost):'Cost missing'}</td><td style={{padding:9,color:row.profit!==null&&row.profit<0?'#dc2626':'inherit'}}>{row.profit===null?'Cost not recorded':money(row.profit)}</td><td style={{padding:9}}>{row.stock}</td><td style={{padding:9}}>{row.wasteQty||0}</td><td style={{padding:9}}>{row.cancelledQty||0}</td></>:section==='Customers'?<><td style={{padding:9}}><b>{row.name}</b></td><td style={{padding:9}}>{row.phone||'—'}</td><td style={{padding:9}}>{row.visits}</td><td style={{padding:9}}>{money(row.total)}</td><td style={{padding:9}}>{money(row.due)}</td></>:section==='Suppliers'?<><td style={{padding:9}}><b>{row.name}</b></td><td style={{padding:9}}>{row.phone||'—'}</td><td style={{padding:9}}>{money(row.total)}</td><td style={{padding:9}}>{money(row.paid)}</td><td style={{padding:9}}>{money(row.due)}</td></>:<><td style={{padding:9}}><b>{row.name}</b>{row.active===false&&<small style={{display:'block',opacity:.7}}>Inactive</small>}</td><td style={{padding:9}}>{row.role||'Staff'}</td><td style={{padding:9}}>{money(row.paid)}</td><td style={{padding:9}}>{money(row.bonuses)}</td><td style={{padding:9}}>{money(row.advances)}</td></>}<td style={{padding:9}}><button className="btn btn-secondary" onClick={e=>{e.stopPropagation();setSelectedRecord(String(row.key));setEntityId(String(row.key));setSelectedBucket('')}}>Open <ChevronRight size={13}/></button></td></tr>)}</tbody></table></div>
      {!filteredEntities.length&&<p style={{padding:18,opacity:.7}}>No records match the selected filters.</p>}
    </div>
    {selected&&<div style={panel}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}><div><div style={{fontSize:11,fontWeight:800,letterSpacing:'.08em',opacity:.65}}>{section.toUpperCase()} HISTORY</div><h3 style={{margin:'4px 0'}}>{selected.name}</h3><p style={{margin:0,opacity:.7,fontSize:13}}>{section==='Products'?selected.sku||'Product history':section==='Customers'?selected.phone||'Customer account history':section==='Suppliers'?selected.phone||'Supplier ledger history':(selected.role||'Staff')+' · '+(selected.active===false?'Inactive':'Active')}</p></div><button className="btn btn-secondary" onClick={()=>{setEntityId('all');setSelectedRecord('');setSelectedBucket('')}}>Clear selection</button></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:14}}>
        {(section==='Products'?[['Units sold',selected.qty],['Sale revenue',money(selected.revenue)],['Cost of goods',selected.costKnown?money(selected.cost):'Cost data missing'],['Profit / loss',selected.profit===null?'Cost data needed':money(selected.profit)],['Stock remaining',selected.stock],['Stock value',selected.stockValue===null?'Cost data needed':money(selected.stockValue)],['Cancelled units',selected.cancelledQty||0],['Waste units',selected.wasteQty||0],['Pending units',selected.pendingQty||0],['Units per selling day',selected.days?.size?(selected.qty/selected.days.size).toFixed(2):'No completed sales'],['Reorder gap',selected.minStock?Math.max(0,selected.minStock-selected.stock)+' units': 'Reorder level not set']]:section==='Customers'?[['Total completed sales',money(selected.total)],['Transactions',selected.visits],['Average sale',money(selected.avg)],['Current due',money(selected.due)]]:section==='Suppliers'?[['Purchase total',money(selected.total)],['Paid',money(selected.paid)],['Estimated due',money(selected.due)],['Purchase records',selected.transactions.length]]:[['Payments',money(selected.paid)],['Bonuses',money(selected.bonuses)],['Advances',money(selected.advances)],['Estimated remaining',money(selected.due)]]).map(([label,value])=><div key={label} style={{padding:12,borderRadius:10,background:'var(--surface,#f8fafc)'}}><div style={{fontSize:11,opacity:.7}}>{label}</div><b style={{display:'block',marginTop:4}}>{value}</b></div>)}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:16}}><h4 style={{margin:0}}>Transaction timeline</h4><span style={{fontSize:12,opacity:.7}}>{selectedTxFiltered.length} matching events</span></div>
      <div style={{overflowX:'auto',marginTop:8}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr>{['Date / time','Status / event','Reference','Customer / details','Qty / hours','Cost / outflow','Sale / payment','Profit / loss / balance','Remaining'].map(h=><th key={h} style={{textAlign:'left',padding:8,borderBottom:'1px solid var(--border,#e5e7eb)',whiteSpace:'nowrap'}}>{h}</th>)}</tr></thead><tbody>{selectedTxFiltered.slice().sort((a,b)=>new Date(timestampOf(b.order||b)||0)-new Date(timestampOf(a.order||a)||0)).slice(0,200).map((tx,i)=>{const order=tx.order||tx;const status=tx.status||orderStatus(order);const date=status==='Cancelled'?(order.cancelledAt||timestampOf(order)||timestampOf(tx)):status==='Waste'?(order.wastedAt||timestampOf(order)||timestampOf(tx)):timestampOf(order)||timestampOf(tx);const isProduct=section==='Products';const item=tx.item;const items=item?[item]:(order.items||[]);const qty=item?itemQuantity(item):items.reduce((n,it)=>n+itemQuantity(it),0);const sale=isProduct?(tx.amount??itemSale(item||{})):(tx.amount??(totalOf(order)||tx.total||0));const itemCosts=items.map(it=>itemCostTotal(it));const costKnown=itemCosts.length>0&&itemCosts.every(v=>v!==null);const cost=isProduct?(tx.cost??(itemCosts[0]??null)):(costKnown?itemCosts.reduce((n,v)=>n+v,0):null);const profit=tx.profit??(cost!==null&&status==='Completed'&&sale!==null?sale-cost:null);const title=isProduct?(item?.name||tx.name||'Product movement'):section==='Customers'?(order.customer||tx.customer||tx.name||'Customer account'):section==='Suppliers'?(tx.supplier||tx.note||tx.type||'Supplier transaction'):(tx.type||tx.kind||tx.category||'Staff record');const ref=order.id||tx.reference||tx.id||tx.type||'Transaction';const lineDetails=items.map(it=>safeName(it.name)+' ×'+itemQuantity(it)).join(', ');const detail=[order.payment||tx.method,lineDetails,order.orderNote||order.notes||tx.note||tx.reason,order.cancelReason,order.wasteReason,order.serviceType,order.tableNumber,order.cancelledBy||order.wastedBy||tx.by].filter(Boolean).join(' · ');const amount=tx.amount??tx.total??(tx.price!==undefined?Number(tx.price)*Number(tx.qty):null);return <tr key={tx.id||order.id||i}><td style={{padding:8,whiteSpace:'nowrap'}}>{date?new Date(date).toLocaleString():'—'}</td><td style={{padding:8,whiteSpace:'nowrap'}}><span style={{padding:'3px 6px',borderRadius:6,background:status==='Cancelled'||status==='Waste'?'#fee2e2':status==='Pending'?'#fef3c7':'var(--surface,#f3f4f6)'}}>{status}</span></td><td style={{padding:8}}>{ref}</td><td style={{padding:8,minWidth:150}}><b>{title}</b>{detail&&<small style={{display:'block',opacity:.7,marginTop:3}}>{detail}</small>}</td><td style={{padding:8}}>{qty?qty:tx.hours??tx.duration??'—'}</td><td style={{padding:8,whiteSpace:'nowrap'}}>{cost!==null?money(cost):(amount!==null&&section==='Suppliers'?money(amount):'Not recorded')}</td><td style={{padding:8,whiteSpace:'nowrap'}}>{status==='Cancelled'||status==='Waste'?'—':sale!==null&&sale!==0?money(sale):(amount!==null?money(amount):'—')}</td><td style={{padding:8,whiteSpace:'nowrap',color:profit!==null&&profit<0?'#dc2626':'inherit'}}>{section==='Suppliers'?money(selected.due):section==='Staff'?money(selected.due):profit!==null?money(profit):status==='Waste'&&cost!==null?'Loss '+money(cost):'Not recorded'}</td><td style={{padding:8,whiteSpace:'nowrap'}}>{section==='Products'?selected.stock:section==='Customers'?money(selected.due):section==='Suppliers'?money(selected.due):money(selected.due)}</td></tr>})}</tbody></table></div>
      {!selectedTxFiltered.length&&<p style={{opacity:.7,padding:'10px 0'}}>No transaction events are available for this record in the selected period. Historical data not recorded by the POS cannot be reconstructed.</p>}
      {section==='Staff'&&<p style={{fontSize:12,opacity:.7,marginBottom:0}}>Bonuses, advances, and remaining amounts are estimates from recorded payment types and salary fields. Verify staff-payment categories and salary settings before using these figures for payroll.</p>}
      {section==='Suppliers'&&<p style={{fontSize:12,opacity:.7,marginBottom:0}}>Supplier balances are estimated from purchase records and the supplier due field; payment entries may overlap depending on how your ledger was recorded.</p>}
      {section==='Products'&&selected.profit===null&&<p style={{fontSize:12,opacity:.7,marginBottom:0}}>Profit is not guessed. Add a reliable unit cost or recipe-cost field to sales items to calculate product-level profit. Stock valuation and reorder gaps are only available when product cost and minimum-stock settings are configured.</p>}
    </div>}
  </div>;
}
