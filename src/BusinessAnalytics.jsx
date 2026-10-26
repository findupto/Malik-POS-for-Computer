import React, { useMemo, useState } from 'react';
import { BarChart3, Users, Package, BriefcaseBusiness, CalendarDays, Search, TrendingUp, CircleDollarSign, Filter, ChevronRight } from 'lucide-react';

const money = n => 'Rs. ' + new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Number(n) || 0);
const dateOf = value => String(value || '').slice(0, 10);
const completed = order => !['cancelled', 'waste', 'pending'].includes(String(order.status || 'completed').toLowerCase());
const totalOf = order => Math.max(0, Number(order.total || 0) - Number(order.refundedTotal || 0));
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

export default function BusinessAnalytics({ orders=[], products=[], customers=[], suppliers=[], staff=[], staffPayments=[], attendance=[], ledgerPayments=[], expenses=[], stockPurchases=[] }) {
  const [section,setSection] = useState('Products');
  const [from,setFrom] = useState('');
  const [to,setTo] = useState('');
  const [search,setSearch] = useState('');
  const [entityId,setEntityId] = useState('all');
  const [chartMode,setChartMode] = useState('bar');
  const [selectedBucket,setSelectedBucket] = useState('');
  const [selectedRecord,setSelectedRecord] = useState('');
  const inRange = value => { const date=dateOf(value); return (!from || (date && date>=from)) && (!to || (date && date<=to)); };
  const sales = useMemo(()=>orders.filter(o=>completed(o)&&inRange(o.date)),[orders,from,to]);
  const visibleOrders = useMemo(()=>sales.filter(o=>!search||[o.id,o.customer,o.payment,o.status,(o.items||[]).map(i=>i.name+' '+i.sku).join(' ')].join(' ').toLowerCase().includes(search.toLowerCase())),[sales,search]);
  const productRows = useMemo(()=>{
    const map=new Map();
    for(const order of sales) for(const item of order.items||[]) {
      const key=String(item.productId??item.id??item.sku??(item.name+'|'+(item.variant||'')));
      const row=map.get(key)||{key,name:safeName(item.name),variant:item.variant||'',sku:item.sku||'',qty:0,revenue:0,cost:0,costKnown:true,orders:0,days:new Set(),transactions:[]};
      const qty=Math.max(0,Number(item.qty)||0); row.qty+=qty; row.revenue+=Math.max(0,Number(item.price)||0)*qty;
      const unitCost=getItemCost(item); if(unitCost===null)row.costKnown=false; else row.cost+=unitCost*qty;
      row.orders+=1; row.days.add(dateOf(order.date)); row.transactions.push({order,item,amount:Math.max(0,Number(item.price)||0)*qty});map.set(key,row);
    }
    return [...map.values()].map(row=>({...row,profit:row.costKnown?row.revenue-row.cost:null})).sort((a,b)=>b.qty-a.qty);
  },[sales]);
  const productRowsWithCatalog = useMemo(()=>products.map(p=>{const row=productRows.find(x=>String(x.key)===String(p.id)||String(x.sku)===String(p.sku)||x.name===p.name);return row||{key:String(p.id),name:p.name,variant:p.variant||'',sku:p.sku||'',qty:0,revenue:0,cost:0,costKnown:false,profit:null,orders:0,days:new Set(),transactions:[]}}),[products,productRows]);
  const customerRows = useMemo(()=>customers.map(c=>{const tx=sales.filter(o=>safeName(o.customer)===safeName(c.name));const paid=tx.reduce((n,o)=>n+totalOf(o),0);const payments=ledgerPayments.filter(p=>String(p.customer||p.entityName||'')===String(c.name));return {...c,key:String(c.id??c.name),transactions:tx,total:paid,visits:tx.length,avg:tx.length?paid/tx.length:0,payments,due:Number(c.dueBalance||c.due||0)}}).sort((a,b)=>b.total-a.total),[customers,sales,ledgerPayments]);
  const supplierRows = useMemo(()=>suppliers.map(s=>{const name=safeName(s.name);const purchases=stockPurchases.filter(p=>safeName(p.supplier)===name&&inRange(p.date||p.createdAt));const paid=purchases.reduce((n,p)=>n+Math.max(0,Number(p.paid)||0),0);const spend=purchases.reduce((n,p)=>n+Math.max(0,Number(p.total)||0),0);const payments=ledgerPayments.filter(p=>String(p.supplier||p.entityName||'')===name&&inRange(p.date||p.createdAt));return {...s,key:String(s.id??name),transactions:purchases,total:spend,paid,due:purchases.reduce((n,p)=>n+Math.max(0,Number(p.total||0)-Number(p.paid||0)),0)+Math.max(0,Number(s.due)||0),payments}}).sort((a,b)=>b.total-a.total),[suppliers,stockPurchases,ledgerPayments,from,to]);
  const staffRows = useMemo(()=>staff.map(person=>{const id=String(person.id??person.username??person.name);const payments=staffPayments.filter(p=>String(p.staffId??p.employeeId??p.staff_id??p.name??'')===id||String(p.staffName??p.employeeName??'')===String(person.name));const time=attendance.filter(a=>String(a.staffId??a.employeeId??a.staff_id??'')===id||String(a.staffName??a.name??'')===String(person.name)).filter(a=>inRange(a.date||a.checkIn||a.createdAt));const paid=payments.filter(p=>inRange(p.date||p.createdAt)).reduce((n,p)=>n+Math.max(0,Number(p.amount)||0),0);const bonuses=payments.filter(p=>/bonus/i.test(String(p.type||p.kind||p.category||''))).reduce((n,p)=>n+Math.max(0,Number(p.amount)||0),0);const advances=payments.filter(p=>/advance/i.test(String(p.type||p.kind||p.category||''))).reduce((n,p)=>n+Math.max(0,Number(p.amount)||0),0);return {...person,key:id,payments:payments.filter(p=>inRange(p.date||p.createdAt)),attendance:time,paid,bonuses,advances,due:Math.max(0,Number(person.salary||person.monthlySalary||0)-paid)}}).sort((a,b)=>b.paid-a.paid),[staff,staffPayments,attendance,from,to]);
  const filteredEntities = useMemo(()=>{
    const list=section==='Products'?productRowsWithCatalog:section==='Customers'?customerRows:section==='Suppliers'?supplierRows:staffRows;
    return list.filter(row=>(entityId==='all'||String(row.key)===entityId)&&(!search||[row.name,row.sku,row.phone,row.username,row.role].join(' ').toLowerCase().includes(search.toLowerCase())));
  },[section,productRowsWithCatalog,customerRows,supplierRows,staffRows,entityId,search]);
  const selected = filteredEntities.find(row=>String(row.key)===String(selectedRecord)) || filteredEntities[0] || null;
  const chartData = useMemo(()=>{
    if(section==='Products') return filteredEntities.slice(0,12).map(r=>({key:r.key,label:r.name,value:r.qty}));
    if(section==='Customers') return filteredEntities.slice(0,12).map(r=>({key:r.key,label:r.name,value:r.total}));
    if(section==='Suppliers') return filteredEntities.slice(0,12).map(r=>({key:r.key,label:r.name,value:r.total}));
    return filteredEntities.slice(0,12).map(r=>({key:r.key,label:r.name,value:r.paid}));
  },[section,filteredEntities]);
  const selectedTransactions = selected ? section==='Products' ? selected.transactions||[] : section==='Customers' ? selected.transactions||[] : section==='Suppliers' ? selected.transactions||[] : [...(selected.payments||[]),...(selected.attendance||[]).map(a=>({...a,type:'Attendance'}))] : [];
  const selectedTxFiltered = selectedTransactions.filter(tx=>{const order=tx.order||tx;return !selectedBucket || String(order.id??tx.id??tx.date??'')===selectedBucket || dateOf(order.date||tx.date||tx.createdAt)===selectedBucket;});
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
    const csv='\\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replaceAll('"','""')+'"').join(',')).join('\\r\\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));const a=document.createElement('a');a.href=url;a.download='malik-pos-'+section.toLowerCase()+'-analytics.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  };
  const sectionButtons=['Products','Customers','Suppliers','Staff'];
  return <div style={{display:'grid',gap:16}}>
    <div style={{...panel,background:'linear-gradient(135deg,var(--panel,#fff),var(--surface,#f8fafc))'}}>
      <div style={{display:'flex',gap:12,alignItems:'center',justifyContent:'space-between',flexWrap:'wrap'}}>
        <div><div style={{fontSize:11,fontWeight:800,letterSpacing:'.1em',opacity:.65}}>BUSINESS INTELLIGENCE</div><h2 style={{margin:'5px 0'}}>Detailed analytics</h2><p style={{margin:0,opacity:.72}}>Filter by date, search every record, click a chart to open a profile and transaction history.</p></div>
        <button className="btn btn-secondary" onClick={exportCsv}>Export filtered CSV</button>
      </div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:16}}>
        <div><label style={smallLabel}>FROM DATE</label><input style={field} type="date" value={from} onChange={e=>{setFrom(e.target.value);setSelectedBucket('')}}/></div>
        <div><label style={smallLabel}>TO DATE</label><input style={field} type="date" value={to} onChange={e=>{setTo(e.target.value);setSelectedBucket('')}}/></div>
        <div><label style={smallLabel}>SEARCH ALL RECORDS</label><div style={{position:'relative'}}><Search size={15} style={{position:'absolute',left:10,top:12,opacity:.55}}/><input style={{...field,paddingLeft:32}} value={search} onChange={e=>{setSearch(e.target.value);setSelectedRecord('')}} placeholder="Name, SKU, transaction…"/></div></div>
        <div><label style={smallLabel}>SELECT RECORD</label><select style={field} value={entityId} onChange={e=>{setEntityId(e.target.value);setSelectedRecord('');setSelectedBucket('')}}><option value="all">All records</option>{(section==='Products'?productRowsWithCatalog:section==='Customers'?customerRows:section==='Suppliers'?supplierRows:staffRows).map(r=><option key={r.key} value={r.key}>{r.name}</option>)}</select></div>
      </div>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:14}}>{sectionButtons.map(s=><button key={s} className={'btn '+(section===s?'btn-primary':'btn-secondary')} onClick={()=>{setSection(s);setEntityId('all');setSelectedRecord('');setSelectedBucket('')}}>{s==='Products'?<Package size={15}/>:s==='Staff'?<Users size={15}/>:s==='Suppliers'?<BriefcaseBusiness size={15}/>:<Users size={15}/>} {s}</button>)}</div>
    </div>
    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))',gap:12}}>
      {metric.map(([label,value],i)=><div key={label} style={panel}><div style={{display:'flex',alignItems:'center',gap:8,opacity:.72,fontSize:12}}>{i===0?<TrendingUp size={16}/>:i===1?<CircleDollarSign size={16}/>:i===2?<Filter size={16}/>:<BarChart3 size={16}/>} {label}</div><div style={{fontSize:22,fontWeight:800,marginTop:8,overflowWrap:'anywhere'}}>{value}</div></div>)}
    </div>
    <div style={{...panel}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap',marginBottom:12}}><div><h3 style={{margin:'0 0 4px'}}>{section} comparison</h3><p style={{margin:0,opacity:.7,fontSize:13}}>{section==='Products'?'Units sold by product':section==='Customers'?'Sales by customer':section==='Suppliers'?'Purchases by supplier':'Recorded staff payments by person'}</p></div><span style={{fontSize:12,opacity:.65}}>{chartData.length} chart points</span></div>
      <ClickChart data={chartData} mode={chartMode} setMode={setChartMode} selected={entityId!=='all'?entityId:selectedBucket} onSelect={key=>{setEntityId(key);setSelectedRecord(key);setSelectedBucket('')}}/>
      <div style={{display:'flex',gap:8,flexWrap:'wrap',marginTop:8}}>{chartData.map(row=><button key={row.key} className={'btn '+(String(entityId)===String(row.key)?'btn-primary':'btn-secondary')} onClick={()=>{setEntityId(String(row.key));setSelectedRecord(String(row.key));setSelectedBucket('')}} style={{fontSize:12}}>{row.label} · {section==='Products'?row.value.toLocaleString():money(row.value)}</button>)}</div>
    </div>
    <div style={{...panel}}>
      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,flexWrap:'wrap'}}><div><h3 style={{margin:'0 0 4px'}}>{section} records</h3><p style={{margin:0,opacity:.7,fontSize:13}}>Select a row to open its detailed history.</p></div><span style={{fontSize:12,opacity:.65}}>{filteredEntities.length} records</span></div>
      <div style={{overflowX:'auto',marginTop:12}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:13}}><thead><tr>{(section==='Products'?['Product','SKU','Units','Revenue','Profit']:section==='Customers'?['Customer','Phone','Transactions','Sales','Due']:section==='Suppliers'?['Supplier','Phone','Purchases','Paid','Due']:['Staff member','Role','Payments','Bonus','Advance']).map(h=><th key={h} style={{textAlign:'left',padding:'10px 8px',borderBottom:'1px solid var(--border,#e5e7eb)',whiteSpace:'nowrap'}}>{h}</th>)}<th style={{padding:'10px 8px',borderBottom:'1px solid var(--border,#e5e7eb)'}}>History</th></tr></thead><tbody>{filteredEntities.map(row=><tr key={row.key} onClick={()=>{setSelectedRecord(String(row.key));setEntityId(String(row.key));setSelectedBucket('')}} style={{cursor:'pointer',background:String(selected?.key)===String(row.key)?'var(--surface,#f3f4f6)':'transparent'}}>{section==='Products'?<><td style={{padding:9}}><b>{row.name}</b>{row.variant&&<small style={{display:'block',opacity:.7}}>{row.variant}</small>}</td><td style={{padding:9}}>{row.sku||'—'}</td><td style={{padding:9}}>{row.qty}</td><td style={{padding:9}}>{money(row.revenue)}</td><td style={{padding:9}}>{row.profit===null?'Cost not recorded':money(row.profit)}</td></>:section==='Customers'?<><td style={{padding:9}}><b>{row.name}</b></td><td style={{padding:9}}>{row.phone||'—'}</td><td style={{padding:9}}>{row.visits}</td><td style={{padding:9}}>{money(row.total)}</td><td style={{padding:9}}>{money(row.due)}</td></>:section==='Suppliers'?<><td style={{padding:9}}><b>{row.name}</b></td><td style={{padding:9}}>{row.phone||'—'}</td><td style={{padding:9}}>{money(row.total)}</td><td style={{padding:9}}>{money(row.paid)}</td><td style={{padding:9}}>{money(row.due)}</td></>:<><td style={{padding:9}}><b>{row.name}</b>{row.active===false&&<small style={{display:'block',opacity:.7}}>Inactive</small>}</td><td style={{padding:9}}>{row.role||'Staff'}</td><td style={{padding:9}}>{money(row.paid)}</td><td style={{padding:9}}>{money(row.bonuses)}</td><td style={{padding:9}}>{money(row.advances)}</td></>}<td style={{padding:9}}><button className="btn btn-secondary" onClick={e=>{e.stopPropagation();setSelectedRecord(String(row.key));setEntityId(String(row.key));setSelectedBucket('')}}>Open <ChevronRight size={13}/></button></td></tr>)}</tbody></table></div>
      {!filteredEntities.length&&<p style={{padding:18,opacity:.7}}>No records match the selected filters.</p>}
    </div>
    {selected&&<div style={panel}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}><div><div style={{fontSize:11,fontWeight:800,letterSpacing:'.08em',opacity:.65}}>{section.toUpperCase()} HISTORY</div><h3 style={{margin:'4px 0'}}>{selected.name}</h3><p style={{margin:0,opacity:.7,fontSize:13}}>{section==='Products'?selected.sku||'Product history':section==='Customers'?selected.phone||'Customer account history':section==='Suppliers'?selected.phone||'Supplier ledger history':(selected.role||'Staff')+' · '+(selected.active===false?'Inactive':'Active')}</p></div><button className="btn btn-secondary" onClick={()=>{setEntityId('all');setSelectedRecord('');setSelectedBucket('')}}>Clear selection</button></div>
      <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(150px,1fr))',gap:10,marginTop:14}}>
        {(section==='Products'?[['Units sold',selected.qty],['Revenue',money(selected.revenue)],['Profit',selected.profit===null?'Cost data needed':money(selected.profit)],['Order lines',selected.transactions.length]]:section==='Customers'?[['Total sales',money(selected.total)],['Transactions',selected.visits],['Average sale',money(selected.avg)],['Current due',money(selected.due)]]:section==='Suppliers'?[['Purchase total',money(selected.total)],['Paid',money(selected.paid)],['Estimated due',money(selected.due)],['Purchase records',selected.transactions.length]]:[['Payments',money(selected.paid)],['Bonuses',money(selected.bonuses)],['Advances',money(selected.advances)],['Estimated remaining',money(selected.due)]]).map(([label,value])=><div key={label} style={{padding:12,borderRadius:10,background:'var(--surface,#f8fafc)'}}><div style={{fontSize:11,opacity:.7}}>{label}</div><b style={{display:'block',marginTop:4}}>{value}</b></div>)}
      </div>
      <div style={{display:'flex',justifyContent:'space-between',gap:8,alignItems:'center',flexWrap:'wrap',marginTop:16}}><h4 style={{margin:0}}>Transaction timeline</h4><span style={{fontSize:12,opacity:.7}}>{selectedTxFiltered.length} matching events</span></div>
      <div style={{overflowX:'auto',marginTop:8}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:12}}><thead><tr>{['Date','Reference / event','Details','Amount'].map(h=><th key={h} style={{textAlign:'left',padding:8,borderBottom:'1px solid var(--border,#e5e7eb)'}}>{h}</th>)}</tr></thead><tbody>{selectedTxFiltered.slice().sort((a,b)=>new Date(b.order?.date||b.date||b.createdAt||0)-new Date(a.order?.date||a.date||a.createdAt||0)).slice(0,150).map((tx,i)=>{const order=tx.order||tx;const date=order.date||tx.date||tx.createdAt||tx.checkIn||'';const amount=tx.amount??tx.total??tx.price*tx.qty??0;return <tr key={tx.id||order.id||i}><td style={{padding:8,whiteSpace:'nowrap'}}>{date?new Date(date).toLocaleString():'—'}</td><td style={{padding:8}}>{order.id||tx.reference||tx.type||'Transaction'}</td><td style={{padding:8}}>{section==='Products'?(tx.item?.name||tx.name||'Product sale'):section==='Customers'?(order.payment||tx.method||'Customer transaction'):section==='Suppliers'?(tx.supplier||tx.note||'Purchase / supplier payment'):(tx.type||tx.kind||'Staff record')}</td><td style={{padding:8,whiteSpace:'nowrap'}}>{amount?money(amount):'—'}</td></tr>})}</tbody></table></div>
      {!selectedTxFiltered.length&&<p style={{opacity:.7,padding:'10px 0'}}>No transaction events are available for this record in the selected period. Historical data not recorded by the POS cannot be reconstructed.</p>}
      {section==='Staff'&&<p style={{fontSize:12,opacity:.7,marginBottom:0}}>Bonuses, advances, and remaining amounts are estimates from recorded payment types and salary fields. Verify staff-payment categories and salary settings before using these figures for payroll.</p>}
      {section==='Suppliers'&&<p style={{fontSize:12,opacity:.7,marginBottom:0}}>Supplier balances are estimated from purchase records and the supplier due field; payment entries may overlap depending on how your ledger was recorded.</p>}
      {section==='Products'&&selected.profit===null&&<p style={{fontSize:12,opacity:.7,marginBottom:0}}>Profit is not guessed. Add a reliable unit cost or recipe-cost field to sales items to calculate product-level profit.</p>}
    </div>}
  </div>;
}
