import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity, Calendar, MapPin, Phone, User, ArrowDownToLine, ArrowLeft, ArrowRight, BarChart3, Bell, Bot, Check, CheckCircle2,
  ChevronDown, CircleHelp, ClipboardList, CloudUpload, CreditCard, ExternalLink, Eye, FileSpreadsheet,
  Filter, Globe, LayoutDashboard, Leaf, LogOut, Menu, MessageCircle, Package, Palette, Plus, Search,
  Settings2, ShoppingBag, ShoppingCart, Sparkles, Store as StoreIcon, Tag, Trash2, TrendingUp,
  Upload, Users, X, Zap
} from 'lucide-react'
import { api, hasToken, logout, type Analytics, type Category, type CheckoutConfig, type Order, type Product, type Store } from './api'
import PublicStorefront from './PublicStorefront'

type RazorpayCheckoutResponse={razorpay_payment_id:string;razorpay_order_id:string;razorpay_signature:string}
type RazorpayCheckoutOptions={key:string;amount:number;currency:string;name:string;description:string;order_id:string;prefill:{name:string;contact:string};handler:(response:RazorpayCheckoutResponse)=>void;modal:{ondismiss:()=>void}}
declare global { interface Window { Razorpay?:new(options:RazorpayCheckoutOptions)=>{open:()=>void;on:(event:string,handler:(event:any)=>void)=>void} } }

type Page = 'overview'|'setup'|'catalog'|'themes'|'storefront'|'orders'|'content'|'assistant'|'settings'
type ThemePreviewPage = 'home'|'login'|'signup'|'catalogue'|'product'|'cart'|'checkout'|'tracking'
type CartLine = { product:Product; quantity:number }
const themeOptions = [
  {id:'modern-clean',name:'Modern Fresh',desc:'Bright, airy and versatile',color:'#18794e',bg:'#effaf3'},
  {id:'premium-dark',name:'Forest Luxe',desc:'Deep green with premium contrast',color:'#123b2a',bg:'#e9f4ed'},
  {id:'fresh-grocery',name:'Market Garden',desc:'Natural, friendly and organic',color:'#4d8d38',bg:'#f3fae9'},
  {id:'elegant-boutique',name:'Botanical Boutique',desc:'Soft sage with editorial spacing',color:'#758b65',bg:'#f4f4ed'}
]
const sampleByCategory: Record<string, Omit<Product,'id'>[]> = {
  Electronics: [
    {name:'Wireless Mouse',description:'Silent-click mouse with ergonomic design.',sku:'ELEC-001',category:null,price:'599.00',stock:25,low_stock_threshold:5,is_active:true,is_demo:true,image_url:'https://images.unsplash.com/photo-1527814050087-3793815479db?w=600'},
    {name:'USB-C Fast Charger',description:'Compact fast charger for everyday devices.',sku:'ELEC-002',category:null,price:'899.00',stock:18,low_stock_threshold:5,is_active:true,is_demo:true,image_url:'https://images.unsplash.com/photo-1583863788434-e58a36330cf0?w=600'}
  ],
  Clothing: [
    {name:'Everyday Cotton T-shirt',description:'Soft cotton tee with a relaxed fit.',sku:'CLO-001',category:null,price:'449.00',stock:32,low_stock_threshold:6,is_active:true,is_demo:true,image_url:'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600'},
    {name:'Canvas Tote Bag',description:'Reusable everyday bag with reinforced handles.',sku:'CLO-002',category:null,price:'299.00',stock:21,low_stock_threshold:5,is_active:true,is_demo:true,image_url:'https://images.unsplash.com/photo-1544816155-12df9643f363?w=600'}
  ],
  Groceries: [
    {name:'Organic Brown Rice · 1 kg',description:'Nutritious everyday rice sourced from local farms.',sku:'GRO-001',category:null,price:'129.00',stock:40,low_stock_threshold:8,is_active:true,is_demo:true,image_url:'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=600'},
    {name:'Cold-Pressed Coconut Oil',description:'Small-batch coconut oil for kitchen essentials.',sku:'GRO-002',category:null,price:'249.00',stock:14,low_stock_threshold:5,is_active:true,is_demo:true,image_url:'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=600'}
  ],
  'Home & Kitchen': [
    {name:'Ceramic Coffee Mug',description:'Minimal ceramic mug for your morning coffee.',sku:'HOME-001',category:null,price:'349.00',stock:17,low_stock_threshold:5,is_active:true,is_demo:true,image_url:'https://images.unsplash.com/photo-1514228742587-6b1558fcca3d?w=600'},
    {name:'Linen Cushion Cover',description:'Soft neutral cushion cover for a calm home.',sku:'HOME-002',category:null,price:'399.00',stock:12,low_stock_threshold:4,is_active:true,is_demo:true,image_url:'https://images.unsplash.com/photo-1584100936595-c0654b55a2e2?w=600'}
  ]
}
const defaultCategories = ['Electronics','Clothing','Groceries','Home & Kitchen']
const money = (n: string|number) => `₹${Number(n||0).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2})}`
function WorkspaceApp({ onSignOut, initialEmail }: { onSignOut: () => void; initialEmail?: string }) {
  const [page,setPage] = useState<Page>('overview')
  const [mobileNav,setMobileNav] = useState(false)
  const [store,setStore] = useState<Store|null>(null)
  const [stores,setStores] = useState<Store[]>([])
  const [products,setProducts] = useState<Product[]>([])
  const [categories,setCategories] = useState<Category[]>([])
  const [analytics,setAnalytics] = useState<Analytics|null>(null)
  const [orders,setOrders] = useState<Order[]>([])
  const [myOrders,setMyOrders] = useState<Order[]>([])
  const [connected,setConnected] = useState(false)
  const [loading,setLoading] = useState(false)
  const [error,setError] = useState('')
  const [notice,setNotice] = useState('')
  const [workflowChoice,setWorkflowChoice] = useState(false)
  const [setupStep,setSetupStep] = useState(0)
  const [setup,setSetup] = useState({name:'',slug:'',email:'',phone:'',address:'',city:'',region:'',country:'India',postalCode:'',businessType:'General retail',description:''})
  const [logo,setLogo] = useState('')
  const [bannerUrl,setBannerUrl] = useState('')
  const [logoUpload,setLogoUpload] = useState<File|null>(null)
  const [bannerUpload,setBannerUpload] = useState<File|null>(null)
  const [categoryNames,setCategoryNames] = useState<string[]>(defaultCategories)
  const [newCategory,setNewCategory] = useState('')
  const [selectedTheme,setSelectedTheme] = useState('modern-clean')
  const [themePreviewPage,setThemePreviewPage] = useState<ThemePreviewPage>('home')
  const [themeColor,setThemeColor] = useState('#18794e')
  const [themeBg,setThemeBg] = useState('#effaf3')
  const [themeFont,setThemeFont] = useState('Inter, sans-serif')
  const [themeLayout,setThemeLayout] = useState('grid')
  const [themeSections,setThemeSections] = useState<string[]>(['hero','categories','products','contact'])
  const [detailProduct,setDetailProduct] = useState<Product|null>(null)
  const [productSearch,setProductSearch] = useState('')
  const [newProduct,setNewProduct] = useState({name:'',sku:'',description:'',price:'',stock:'',category:'',image_url:''})
  const [productModal,setProductModal] = useState(false)
  const [importReport,setImportReport] = useState<string[]>([])
  const [pendingImportFile,setPendingImportFile] = useState<File|null>(null)
  const [importPreview,setImportPreview] = useState<Awaited<ReturnType<typeof api.importProducts>>|null>(null)
  const [csvDragging,setCsvDragging] = useState(false)
  const [csvFileName,setCsvFileName] = useState('')
  const [publicStoreData,setPublicStoreData] = useState<any>(null)
  const [chatInput,setChatInput] = useState('')
  const [chatLoading,setChatLoading] = useState(false)
  const [notificationOpen,setNotificationOpen] = useState(false)
  const [accountOpen,setAccountOpen] = useState(false)
  const [retryQuestion,setRetryQuestion] = useState('')
  const [chat,setChat] = useState<{role:'assistant'|'user';text:string;source?:string}[]>([
    {role:'assistant',text:'Ask about products, categories and inventory in your connected store. Sales and revenue answers are unavailable until reliable order analytics exist.'}
  ])
  const [storefrontQuery,setStorefrontQuery] = useState('')
  const [cart,setCart] = useState<CartLine[]>([])
  const [cartOpen,setCartOpen] = useState(false)
  const [checkoutOpen,setCheckoutOpen] = useState(false)
  const [checkoutConfig,setCheckoutConfig] = useState<CheckoutConfig|null>(null)
  const [checkoutError,setCheckoutError] = useState('')
  const [checkoutBusy,setCheckoutBusy] = useState(false)
  const [checkoutResult,setCheckoutResult] = useState<Order|null>(null)
  const [paymentMethod,setPaymentMethod] = useState<'cod'|'razorpay'>('cod')
  const [checkoutForm,setCheckoutForm] = useState({customer_name:'',customer_phone:'',line1:'',city:'',postal_code:'',country:'India'})
  const paymentFlowActive=useRef(false)
  const [editingContent,setEditingContent] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [toast,setToast] = useState('')
  const [userEmail,setUserEmail] = useState(initialEmail || '')

  const notify = (s:string) => { setToast(s); window.setTimeout(()=>setToast(''),3000) }
  const clearWorkspaceData = () => { setStore(null); setStores([]); setProducts([]); setCategories([]); setAnalytics(null); setOrders([]); setMyOrders([]); setConnected(false); setUserEmail('') }
  const signOut = () => { logout(); clearWorkspaceData(); onSignOut() }
  const run = async <T,>(fn:()=>Promise<T>, success?:string):Promise<T|null> => {
    setLoading(true); setError('')
    try { const result = await fn(); if(success) notify(success); return result }
    catch(e) { const message = e instanceof Error ? e.message : 'Something went wrong'; setError(message); return null }
    finally { setLoading(false) }
  }
  const loadStoreData = async (selected:Store) => {
    try { const savedCart=JSON.parse(localStorage.getItem(`ss_cart_${selected.slug}`)||'[]'); setCart(Array.isArray(savedCart)?savedCart.filter((line:any)=>line?.product?.id&&Number.isInteger(line.quantity)&&line.quantity>0):[]) } catch { setCart([]) }
    setProducts([]); setCategories([]); setAnalytics(null)
    setStore(selected); setSelectedTheme(selected.theme || 'modern-clean')
    const cfg=selected.theme_settings||{}
    setThemeColor(typeof cfg.primary_color==='string'?cfg.primary_color:'#18794e')
    setThemeBg(typeof cfg.background_color==='string'?cfg.background_color:'#effaf3')
    setThemeFont(typeof cfg.font_family==='string'?cfg.font_family:'Inter, sans-serif')
    setThemeLayout(typeof cfg.layout==='string'?cfg.layout:'grid')
    setThemeSections(Array.isArray(cfg.homepage_sections)?cfg.homepage_sections as string[]:['hero','categories','products','contact'])
    const results = await Promise.allSettled([api.products(selected.slug),api.categories(selected.slug),api.analytics(selected.slug),api.storeOrders(selected.slug)])
    if(results[0].status==='fulfilled') setProducts(results[0].value)
    else setError('Products could not load: '+String(results[0].reason))
    if(results[1].status==='fulfilled') setCategories(results[1].value)
    if(results[2].status==='fulfilled') setAnalytics(results[2].value)
    if(results[3].status==='fulfilled') setOrders(results[3].value)
    else setOrders([])
    setConnected(true)
  }
  const refreshStores = async () => {
    const data = await api.stores()
    const list = Array.isArray(data) ? data : data.results
    setStores(list)
    if(list.length) { setStore(null); setProducts([]); setCategories([]); setAnalytics(null); setWorkflowChoice(true); setPage('overview') }
    else { clearWorkspaceData(); setWorkflowChoice(false); setPage('setup') }
  }
  useEffect(()=>{ const expired=()=>{clearWorkspaceData();onSignOut()};window.addEventListener('smartstore:auth-expired',expired);return()=>window.removeEventListener('smartstore:auth-expired',expired) },[])
  useEffect(()=>{ if(page==='storefront'&&store?.is_published){api.publicStore(store.slug).then(setPublicStoreData).catch(()=>setPublicStoreData(null))} else setPublicStoreData(null) },[page,store?.slug,store?.is_published])
  useEffect(()=>{if(page==='orders'&&hasToken())api.myOrders().then(setMyOrders).catch(e=>setError(e instanceof Error?e.message:'Could not load customer orders.'))},[page,store?.slug])
  useEffect(()=>{ if(hasToken()) { run(async()=>{ await api.me().then(u=>setUserEmail(u.email)); await refreshStores() }) } },[])
  const title = ({overview:'Overview',setup:'Create your store',catalog:'Products & categories',themes:'Store themes',storefront:'Storefront preview',orders:'Orders',content:'Store customization',assistant:'AI business assistant',settings:'Settings'} as Record<Page,string>)[page]
  const businessDescription=typeof store?.business_info==='string'?store.business_info:String(store?.business_info?.description||'')
  const storefrontProducts:Product[]=publicStoreData?.products||products
  const storefrontCategories:Category[]=publicStoreData?.categories||categories
  const filteredProducts = useMemo(()=>products.filter(p=>`${p.name} ${p.sku||''} ${p.description||''}`.toLowerCase().includes(productSearch.toLowerCase())),[products,productSearch])
  const cartCount=cart.reduce((count,line)=>count+line.quantity,0)
  const cartSubtotal=cart.reduce((total,line)=>total+Number(line.product.price)*line.quantity,0)
  const nextOrderStatuses:Record<string,string[]>={placed:['confirmed','cancelled'],confirmed:['processing','cancelled'],processing:['shipped','cancelled'],shipped:['delivered'],delivered:[],cancelled:[]}
  const publicStoreUrl=store?new URL(`/store/${store.slug}`,import.meta.env.VITE_PUBLIC_APP_URL||window.location.origin).toString():''
  async function copyStoreUrl(){try{await navigator.clipboard.writeText(publicStoreUrl);notify('Public store URL copied')}catch{setError('Clipboard access is unavailable. Copy the public URL shown in the dashboard.')}}
  async function shareStoreUrl(){try{if(navigator.share)await navigator.share({title:store?.name||'Store',url:publicStoreUrl});else await copyStoreUrl()}catch(e){if(e instanceof Error&&e.name!=='AbortError')setError('Store link could not be shared.')}}
  async function downloadStoreQr(){try{const image=await fetch(`https://api.qrserver.com/v1/create-qr-code/?size=512x512&format=png&data=${encodeURIComponent(publicStoreUrl)}`);if(!image.ok)throw new Error();const blob=await image.blob();const objectUrl=URL.createObjectURL(blob);const link=document.createElement('a');link.href=objectUrl;link.download=`${store?.slug||'store'}-qr.png`;link.click();window.setTimeout(()=>URL.revokeObjectURL(objectUrl),1000)}catch{setError('QR download could not be reached. Check your network and retry.')}}

  async function createStore(e?:React.FormEvent) {
    e?.preventDefault()
    if(!setup.name.trim() || !setup.email.includes('@')) { setError('Enter a store name and a valid contact email.'); return }
    const businessInfo={business_type:setup.businessType,description:setup.description,address:{street:setup.address,city:setup.city,region:setup.region,country:setup.country,postal_code:setup.postalCode}}
    const created=await run(()=>api.createStore({name:setup.name,logo,banner_url:bannerUrl,contact_email:setup.email,phone:setup.phone,business_info:businessInfo}),'Store created')
    if(created) {
      let savedStore=created
      if(logoUpload||bannerUpload) savedStore=await run(()=>api.uploadStoreAssets(created.id,logoUpload,bannerUpload))||created
      setWorkflowChoice(false); setStore(savedStore); setStores(prev=>[...prev.filter(x=>x.id!==savedStore.id),savedStore]); setCategories([]); setProducts([]); setSetupStep(1); setPage('setup')
      setSelectedTheme('modern-clean')
      notify('Store created. Choose categories, then add real products or import a file.')
    }
  }

  async function saveCategories():Promise<boolean> {
    if(!store) return false
    const existing=new Set(categories.map(c=>c.name.toLowerCase()))
    const names=categoryNames.filter(n=>!existing.has(n.toLowerCase()))
    if(names.length) {
      const created=await run(()=>api.bulkCategories(store.slug,names),'Categories saved')
      if(!created) return false
    }
    try { setCategories(await api.categories(store.slug)); return true }
    catch(e) { setError(e instanceof Error?e.message:'Could not reload saved categories.'); return false }
  }

  async function createOneProduct() {
    if(!store || !newProduct.name || !newProduct.sku || newProduct.price==='' || newProduct.stock==='') { setError('Name, SKU, price and stock are required.'); return }
    const payload = {name:newProduct.name,sku:newProduct.sku,description:newProduct.description,price:newProduct.price,stock:Number(newProduct.stock),category:newProduct.category?Number(newProduct.category):null,image_url:newProduct.image_url,is_active:true}
    const created = await run(()=>api.createProduct(store.slug,payload),'Product added')
    if(created) { setProducts(p=>[created,...p]); setProductModal(false); setNewProduct({name:'',sku:'',description:'',price:'',stock:'',category:'',image_url:''}) }
  }
  async function seedProducts() {
    if(!store) { notify('Create a store first.'); setPage('setup'); return }
    const catMap = new Map(categories.map(c=>[c.name.toLowerCase(),c.id]))
    const candidates = categoryNames.flatMap(name=>(sampleByCategory[name]||[]).map(p=>({...p,category:catMap.get(name.toLowerCase())||null})))
    if(!candidates.length) { notify('Choose a supported category first.'); return }
    let added=0
    for(const item of candidates) {
      try { const p = await api.createProduct(store.slug,item as unknown as Record<string,unknown>); if(!p.id) throw new Error('Backend did not confirm the sample product.'); setProducts(old=>[p,...old]); added++ }
      catch(e) { setImportReport(old=>[...old,`${item.name}: ${e instanceof Error?e.message:'Import failed'}`]) }
    }
    notify(`${added} sample products added. Check the product list for any rejected SKUs.`)
  }
  function downloadTemplate() {
    const category=(categories[0]?.name||'REPLACE_WITH_EXISTING_CATEGORY').replace(/"/g,'""')
    const quote=(value:string)=>`"${value.replace(/"/g,'""')}"`
    const csv=['name,price,stock,category,sku,description,image_url',
      `Sample Green Tea,199.00,10,${quote(category)},,Loose leaf green tea,`,
      `Sample Herbal Tea,149.00,8,${quote(category)},,Caffeine-free herbal blend,`
    ].join('\r\n')+'\r\n'
    const url=URL.createObjectURL(new Blob(['\uFEFF',csv],{type:'text/csv;charset=utf-8'})); const a=document.createElement('a'); a.href=url; a.download='smartstore-products-template.csv'; a.click(); URL.revokeObjectURL(url)
  }
  async function downloadExcelTemplate() {
    if(!store) { notify('Create or select a store to download its Excel template.'); return }
    const blob=await run(()=>api.downloadXlsxTemplate(store.slug))
    if(!blob) return
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='smartstore-products-template.xlsx'; a.click(); window.setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  function openCsvImport() {
    if(!store) { notify('Save store details first, then import products.'); return }
    setPage('catalog')
    window.setTimeout(()=>fileRef.current?.click(),0)
  }
  async function importCsv(file:File) {
    if(!store) { notify('Create or select a store before importing products.'); return }
    setCsvFileName(file.name); setImportPreview(null); setPendingImportFile(null); setError('')
    const preview=await run(()=>api.importProducts(store.slug,file,false))
    if(!preview) return
    setImportPreview(preview)
    setPendingImportFile(preview.valid_rows>0?file:null)
  }
  function cancelImport() {
    setImportPreview(null); setPendingImportFile(null); setCsvFileName(''); setError('')
    if(fileRef.current) fileRef.current.value=''
  }
  async function confirmImport() {
    if(!store || !pendingImportFile || !importPreview?.valid_rows) return
    const result=await run(()=>api.importProducts(store.slug,pendingImportFile,true))
    if(!result) return
    try {
      const refreshed=await api.products(store.slug)
      setProducts(refreshed); setImportPreview(result); setPendingImportFile(null)
      notify(`Backend confirmed ${result.successful_rows} imported product(s).`)
    } catch(e) {
      setError(`Import was confirmed, but the product list could not be refreshed: ${e instanceof Error?e.message:'request failed'}`)
    }
  }

  async function saveStoreDetails() {
    if(!store) return
    const updated = await run(()=>api.updateStore(store.id, {
      name: store.name,
      contact_email: store.contact_email || '',
      phone: store.phone || '',
      business_info: store.business_info || '',
      banner_url: store.banner_url || '',
      logo: store.logo || ''
    }), 'Store details saved')
    if(updated) setStore(updated)
  }
  async function uploadStoreImages() {
    if(!store||(!logoUpload&&!bannerUpload)) return
    const updated=await run(()=>api.uploadStoreAssets(store.id,logoUpload,bannerUpload),'Store images uploaded')
    if(updated) { setStore(updated);setStores(old=>old.map(item=>item.id===updated.id?updated:item));setLogoUpload(null);setBannerUpload(null) }
  }
  async function saveTheme(id=selectedTheme) {
    if(!store) { setSelectedTheme(id); notify('Theme preview selected. Create a store to save it.'); return false }
    const settings={...(store.theme_settings||{}),primary_color:themeColor,background_color:themeBg,font_family:themeFont,layout:themeLayout,homepage_sections:themeSections}
    const result=await run(()=>api.updateTheme(store.slug,id,settings),'Theme saved')
    if(result) setStore({...store,theme:id,theme_settings:settings})
    return Boolean(result)
  }
  async function toggleHomeSection(section:string) {
    const next=themeSections.includes(section)?themeSections.filter(x=>x!==section):[...themeSections,section]
    setThemeSections(next)
    if(!store) { notify('Save a store before persisting homepage sections.'); return }
    const settings={...(store.theme_settings||{}),primary_color:themeColor,background_color:themeBg,font_family:themeFont,layout:themeLayout,homepage_sections:next}
    const saved=await run(()=>api.updateTheme(store.slug,selectedTheme,settings),'Homepage sections saved')
    if(saved) setStore({...store,theme_settings:settings})
    else setThemeSections(themeSections)
  }
  async function publishStore() {
    if(!store) return false
    const result=await run(()=>api.publish(store.slug),'Store published')
    if(result?.is_published) setStore({...store,is_published:true})
    return Boolean(result?.is_published)
  }
  async function saveProductEdit(p:Product,field:'stock'|'price',value:string) {
    if(!store) return
    const updated=await run(()=>api.updateProduct(store.slug,p.id,{[field]:field==='stock'?Number(value):value}))
    if(updated) setProducts(old=>old.map(x=>x.id===updated.id?updated:x))
  }
  async function deleteProduct(p:Product) {
    if(!store || !window.confirm(`Delete ${p.name}?`)) return
    const result=await run(()=>api.deleteProduct(store.slug,p.id),'Product deleted')
    if(result!==null) setProducts(old=>old.filter(x=>x.id!==p.id))
  }
  function addToCart(product:Product) {
    const line=cart.find(item=>item.product.id===product.id)
    if((line?.quantity||0)>=product.stock) { notify('Cart quantity cannot exceed the available stock.'); return }
    setCart(line?cart.map(item=>item.product.id===product.id?{...item,quantity:item.quantity+1}:item):[...cart,{product,quantity:1}])
    if(store) localStorage.setItem(`ss_cart_${store.slug}`,JSON.stringify(line?cart.map(item=>item.product.id===product.id?{...item,quantity:item.quantity+1}:item):[...cart,{product,quantity:1}]))
  }
  function changeCartQuantity(productId:number, quantity:number) {
    const line=cart.find(item=>item.product.id===productId)
    if(!line) return
    const next=quantity<1?cart.filter(item=>item.product.id!==productId):quantity>line.product.stock?cart:cart.map(item=>item.product.id===productId?{...item,quantity}:item)
    if(quantity>line.product.stock) notify('Requested quantity exceeds current stock.')
    setCart(next); if(store) localStorage.setItem(`ss_cart_${store.slug}`,JSON.stringify(next))
  }
  async function startCheckout() {
    if(!cart.length) { setCheckoutError('Your cart is empty.'); return }
    if(!store?.is_published) { setCheckoutError('Checkout is available only for a published store.'); return }
    if(!hasToken()) { setCheckoutError('Sign in or create an account to place an order.'); onSignOut(); return }
    setCheckoutBusy(true); setCheckoutError('')
    try {
      const config=await api.checkoutConfig(store.slug)
      setCheckoutConfig(config); setPaymentMethod('cod'); setCheckoutOpen(true); setCartOpen(false)
    } catch(e) { setCheckoutError(e instanceof Error?e.message:'Checkout configuration could not be loaded.') }
    finally { setCheckoutBusy(false) }
  }
  function loadRazorpayCheckout():Promise<void> {
    if(window.Razorpay) return Promise.resolve()
    return new Promise((resolve,reject)=>{
      let script=document.querySelector<HTMLScriptElement>('script[data-smartstore-razorpay]')
      if(!script) { script=document.createElement('script'); script.src='https://checkout.razorpay.com/v1/checkout.js'; script.dataset.smartstoreRazorpay='true'; document.body.appendChild(script) }
      script.addEventListener('load',()=>window.Razorpay?resolve():reject(new Error('Razorpay checkout did not initialize.')),{once:true})
      script.addEventListener('error',()=>reject(new Error('Could not load Razorpay Checkout. Check your network, then retry or use Cash on Delivery.')),{once:true})
    })
  }
  function finishCheckout(order:Order) {
    setCheckoutResult(order); setCheckoutOpen(false); setCart([])
    if(store) localStorage.removeItem(`ss_cart_${store.slug}`)
    setOrders(current=>[order,...current.filter(existing=>existing.id!==order.id)])
    setMyOrders(current=>[order,...current.filter(existing=>existing.id!==order.id)])
    notify(`Order ${order.order_number} saved with ${order.payment_status} payment status.`)
    api.myOrders().then(setMyOrders).catch(()=>{})
    if(store) { api.storeOrders(store.slug).then(setOrders).catch(()=>{}); api.products(store.slug).then(setProducts).catch(()=>{}) }
  }
  async function placeOrder(e:React.FormEvent) {
    e.preventDefault()
    if(!store||!checkoutConfig||!cart.length) return
    setCheckoutBusy(true); setCheckoutError('')
    let pendingOrder:Order|null=null
    try {
      const order=await api.checkout(store.slug,{
        customer_name:checkoutForm.customer_name.trim(),customer_phone:checkoutForm.customer_phone.trim(),
        delivery_address:{line1:checkoutForm.line1.trim(),city:checkoutForm.city.trim(),postal_code:checkoutForm.postal_code.trim(),country:checkoutForm.country.trim()},
        payment_method:paymentMethod,items:cart.map(line=>({product_id:line.product.id,quantity:line.quantity})),
      },crypto.randomUUID())
      pendingOrder=order
      if(paymentMethod==='cod') { finishCheckout(order); return }
      const payment=await api.createPayment(order.order_number)
      await loadRazorpayCheckout()
      if(!window.Razorpay) throw new Error('Razorpay Checkout is not available. Retry or choose Cash on Delivery.')
      paymentFlowActive.current=true
      const checkout=new window.Razorpay({
        key:payment.key_id,amount:payment.amount,currency:payment.currency,name:store.name,
        description:`Order ${order.order_number}`,order_id:payment.razorpay_order_id,
        prefill:{name:checkoutForm.customer_name,contact:checkoutForm.customer_phone},
        handler:async response=>{
          paymentFlowActive.current=false
          try { const verified=await api.verifyPayment(order.order_number,response); finishCheckout(verified) }
          catch(error) { setCheckoutError(error instanceof Error?error.message:'Payment verification failed. The order remains pending; retry verification or contact the store.') }
        },
        modal:{ondismiss:()=>{if(paymentFlowActive.current){paymentFlowActive.current=false;api.failPayment(order.order_number).catch(()=>{});setCheckoutError('Payment was cancelled. No successful payment was recorded; you can retry or choose Cash on Delivery.')}}},
      })
      checkout.on('payment.failed',()=>{if(paymentFlowActive.current){paymentFlowActive.current=false;api.failPayment(order.order_number).catch(()=>{});setCheckoutError('Razorpay reported a failed payment. No payment was marked successful; retry or choose Cash on Delivery.')}})
      checkout.open()
    } catch(error) {
      if(pendingOrder&&paymentMethod==='razorpay') await api.failPayment(pendingOrder.order_number).catch(()=>{})
      setCheckoutError(error instanceof Error?error.message:'Order could not be placed. Please retry.')
    }
    finally { setCheckoutBusy(false) }
  }
  async function updateOrder(orderNumber:string,nextStatus:string) {
    if(!store) return
    const updated=await run(()=>api.updateOrderStatus(store.slug,orderNumber,nextStatus),'Order status updated')
    if(updated) setOrders(current=>current.map(order=>order.id===updated.id?updated:order))
  }
  async function collectCod(orderNumber:string) {
    if(!store) return
    const updated=await run(()=>api.collectCodPayment(store.slug,orderNumber),'COD collection recorded')
    if(updated) setOrders(current=>current.map(order=>order.id===updated.id?updated:order))
  }
  async function cancelMyOrder(orderNumber:string) {
    const updated=await run(()=>api.cancelMyOrder(orderNumber),'Order cancelled and stock restored')
    if(updated) { setMyOrders(current=>current.map(order=>order.id===updated.id?updated:order)); setOrders(current=>current.map(order=>order.id===updated.id?updated:order)) }
  }
  async function sendAssistantQuestion(question:string, includeUser=true) {
    if(!store || !question.trim() || chatLoading) return
    if(includeUser) setChat(old=>[...old,{role:'user',text:question}])
    setChatLoading(true); setRetryQuestion('')
    try {
      const result=await api.aiChat(store.slug,question)
      const evidence=result.evidence
      const sales=evidence.sales_reports as any
      const lowStock=Array.isArray(evidence.low_stock)?evidence.low_stock as {name:string;stock:number}[]:[]
      const periodEvidence=(period:any)=>`${period.start_date} through ${period.end_date_exclusive} (exclusive): ${period.order_count} orders, order value ${period.order_value}; records ${(period.supporting_orders||[]).map((o:any)=>`#${o.id} ${o.status} ${o.order_value}`).join(', ')||'none'}${period.supporting_orders_truncated?' (first 50 shown)':''}`
      const source=sales?`${evidence.product_count} real products, ${Array.isArray(evidence.category_names)?evidence.category_names.length:0} categories, ${lowStock.length} low-stock items (${lowStock.map(p=>`${p.name}: ${p.stock}`).join(', ')||'none'}). Today: ${periodEvidence(sales.today)}. This week: ${periodEvidence(sales.this_week)}. Last week: ${periodEvidence(sales.last_week)}. This month: ${periodEvidence(sales.this_month)}. Top products this month: ${(sales.this_month.top_products||[]).map((p:any)=>`${p.name} (${p.units} units, ${p.order_value})`).join(', ')||'no order line items'}. Currency ${sales.currency}; ${sales.order_value_note}`:`${evidence.product_count} real product records and ${lowStock.length} low-stock items.`
      setChat(old=>[...old,{role:'assistant',text:result.answer,source}])
    } catch(e) {
      setChat(old=>[...old,{role:'assistant',text:e instanceof Error?e.message:'Assistant request failed. Please retry.'}])
      setRetryQuestion(question)
    } finally { setChatLoading(false) }
  }
  async function askAssistant(e:React.FormEvent) {
    e.preventDefault()
    const question=chatInput.trim()
    if(!question) return
    setChatInput('')
    if(!store) { setChat(old=>[...old,{role:'assistant',text:'Connect to a store first. I cannot query store data until a store is selected.'}]); return }
    await sendAssistantQuestion(question)
  }

  const navItems:{id:Page;label:string;icon:any}[]=[
    {id:'setup',label:'Create Store Website',icon:StoreIcon},
    {id:'assistant',label:'AI Assistant',icon:Bot},
    {id:'content',label:'Edit Existing Website',icon:Settings2},
  ]
  const editorItems:{id:Page;label:string}[]=[
    {id:'content',label:'Website details'},
    {id:'themes',label:'Theme & style'},
    {id:'catalog',label:'Products & categories'},
    {id:'storefront',label:'Preview & publish'},
    {id:'orders',label:'Orders'},
    {id:'overview',label:'Analytics'},
    {id:'settings',label:'Connection settings'},
  ]
  const baseTheme=themeOptions.find(t=>t.id===selectedTheme)||themeOptions[0]
  const theme={...baseTheme,color:themeColor||baseTheme.color,bg:themeBg||baseTheme.bg}

  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav?'sidebar-open':''}`}>
      <div className="brand"><div className="brand-icon"><Leaf size={22}/></div><div><strong>smartstore<span>.ai</span></strong><small>Commerce workspace</small></div><button className="mobile-close" onClick={()=>setMobileNav(false)}><X size={18}/></button></div>
      <div className="workspace-switch"><div className="store-avatar"><StoreIcon size={17}/></div><div className="workspace-name"><b>{store?.name||'My workspace'}</b><small>{store?.is_published?'Live store':store?'Draft store':'No store connected'}</small></div><ChevronDown size={15}/></div>
      <nav className="nav-group owner-main-nav" aria-label="Owner navigation">{navItems.map(n=><button key={n.id} className={`nav-item ${page===n.id?'active':''}`} onClick={()=>{setPage(n.id);setMobileNav(false);setError('')}}><n.icon size={17}/><span>{n.label}</span></button>)}</nav>
      <div className="sidebar-bottom"><div className="help-card"><div className="help-mark"><Sparkles size={16}/></div><b>Build better, sell smarter</b><p>Set up your catalogue, choose a theme and preview your shop.</p><button onClick={()=>setPage('setup')}>Continue setup <ArrowRight size={14}/></button></div><div className="profile-row"><div className="profile-avatar">{(userEmail||'S').slice(0,1).toUpperCase()}</div><div className="profile-copy"><b>{userEmail||'Store owner'}</b><small>Owner workspace</small></div><button className="icon-btn small" title="Sign out" onClick={signOut}><LogOut size={15}/></button></div></div>
    </aside>
    {mobileNav&&<button className="nav-scrim" onClick={()=>setMobileNav(false)} aria-label="Close navigation"/>}
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="icon-btn mobile-menu" onClick={()=>setMobileNav(true)}><Menu size={20}/></button><div className="breadcrumbs"><span>Workspace</span><span className="slash">/</span><b>{title}</b></div></div><div className="topbar-actions"><div className={`connection ${connected?'online':''}`}><i/>{connected?'API connected':'Connecting...'}</div><button className="icon-btn" title="Help" onClick={()=>setPage('settings')}><CircleHelp size={18}/></button><button className="icon-btn notification" title="Notifications" aria-expanded={notificationOpen} onClick={()=>{setNotificationOpen(v=>!v);setAccountOpen(false)}}><Bell size={18}/><i/></button><button className="top-avatar" aria-label="Account menu" aria-expanded={accountOpen} onClick={()=>{setAccountOpen(v=>!v);setNotificationOpen(false)}}>{(userEmail||'S').slice(0,1).toUpperCase()}</button>{notificationOpen&&<div className="panel top-popover"><b>Notifications</b><p>No notifications are available. This workspace does not have a notification feed configured.</p></div>}{accountOpen&&<div className="panel top-popover"><b>{userEmail||'Account'}</b><p>Signed in account</p><button className="btn secondary full" onClick={()=>{setAccountOpen(false);setPage('settings')}}>Account settings</button><button className="btn ghost full" onClick={signOut}><LogOut size={15}/> Sign out</button></div>}</div></header>
      <div className="page-wrap">
        {error&&<div className="alert error"><X size={17}/><span>{error}</span><button onClick={()=>setError('')}><X size={15}/></button></div>}
        {notice&&<div className="alert success"><CheckCircle2 size={17}/>{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}
        {store&&editorItems.some(item=>item.id===page)&&<nav className="editor-subnav" aria-label="Edit existing website">{editorItems.map(item=><button key={item.id} className={page===item.id?'active':''} onClick={()=>setPage(item.id)}>{item.label}</button>)}</nav>}
        {page==='overview'&&<section className="page-content">
          <div className="welcome-row"><div><div className="eyebrow"><span className="eyebrow-dot"/> YOUR COMMERCE, SIMPLIFIED</div><h1>Good things grow here<span>.</span></h1><p className="subhead">Your store at a glance. Keep products moving and customers coming back.</p></div></div>
          {store&&<div className="panel public-url-panel"><div className="panel-heading"><div><h2>Your public store URL</h2><p>{store.is_published?'Share this link with your customers.':'Publish your store to make this URL available to customers.'}</p></div><Globe size={19}/></div><code className="public-url-value">{publicStoreUrl}</code><div className="button-row"><button className="btn primary" disabled={!store.is_published} onClick={()=>window.open(publicStoreUrl,'_blank','noopener,noreferrer')}><ExternalLink size={15}/> Visit Store</button><button className="btn secondary" onClick={copyStoreUrl}>Copy Store URL</button><button className="btn secondary" onClick={shareStoreUrl}>Share Store</button><button className="btn secondary" onClick={downloadStoreQr}>Download QR Code</button></div></div>}
          {!store&&<div className="connect-banner"><div className="banner-icon"><Zap size={23}/></div><div><h3>Connect your Django store</h3><p>Sign in to load your stores, products and analytics from your existing API.</p></div><button className="btn primary" onClick={()=>setPage('setup')}>Create a store <ArrowRight size={16}/></button></div>}
          {workflowChoice&&<div className="panel profile-choice"><div className="panel-heading"><div><h2>Choose how to continue</h2><p>Open a store connected to your account or create a new website.</p></div></div><div className="profile-choice-list">{stores.map(s=><button className="quick-action" key={s.id} onClick={async()=>{await loadStoreData(s);setWorkflowChoice(false)}}><span className="quick-action-icon"><StoreIcon/></span><span><b>{s.name}</b><small>/{s.slug} ? {s.is_published?"Published":"Draft"}</small></span><ArrowRight size={15}/></button>)}</div></div>}
          <div className="metric-grid"><Metric icon={<TrendingUp/>} label="Revenue (last 30 days)" value={analytics?money(analytics.revenue):'—'} change={analytics?'From your store analytics':'Connect to load'} tone="green"/><Metric icon={<ShoppingBag/>} label="Orders" value={analytics?String(analytics.orders):'—'} change={analytics?`${analytics.pending_orders} pending`:'Waiting for API'} tone="blue"/><Metric icon={<Package/>} label="Products" value={String(products.filter(p=>!p.is_demo).length)} change="Real catalogue items" tone="amber"/><Metric icon={<Activity/>} label="Low stock" value={String(analytics?.low_stock?.length??products.filter(p=>!p.is_demo&&p.stock<=(p.low_stock_threshold??5)).length)} change="Needs attention" tone="red"/></div>
          <div className="dashboard-grid"><div className="panel sales-panel"><div className="panel-heading"><div><h2>Store performance</h2><p>Live values from your connected API</p></div><span className="period-chip">Last 30 days</span></div><div className="chart-area"><div className="empty-state"><div><Activity size={22}/></div><b>Revenue history is not available</b><p>The API currently provides a 30-day revenue total, not a dated series for a chart.</p></div></div></div><div className="panel quick-panel"><div className="panel-heading"><div><h2>Quick actions</h2><p>Keep your store moving</p></div><Zap size={18} className="muted-icon"/></div><QuickAction icon={<Package/>} title="Add a product" detail="Create a new catalogue item" onClick={()=>{setPage('catalog');setProductModal(true)}}/><QuickAction icon={<FileSpreadsheet/>} title="Import a spreadsheet" detail="Bring in products from CSV" onClick={()=>setPage('catalog')}/><QuickAction icon={<Palette/>} title="Preview your storefront" detail="Open the selected theme and store content" onClick={()=>setPage('storefront')}/><QuickAction icon={<Bot/>} title="Ask your AI assistant" detail="Explore available store insights" onClick={()=>setPage('assistant')}/></div></div>
          <div className="lower-grid"><div className="panel"><div className="panel-heading"><div><h2>Inventory watch</h2><p>Items that may need replenishment</p></div><button className="text-btn" onClick={()=>setPage('catalog')}>View catalogue <ArrowRight size={14}/></button></div>{(analytics?.low_stock?.length?analytics.low_stock:products.filter(p=>!p.is_demo&&p.stock<=(p.low_stock_threshold??5)).map(p=>({id:p.id,name:p.name,stock:p.stock}))).length===0?<Empty icon={<CheckCircle2/>} title="Inventory looks healthy" text="No low-stock products found in the loaded data."/>:(analytics?.low_stock||products.filter(p=>!p.is_demo&&p.stock<=(p.low_stock_threshold??5))).map((p:any)=><div className="inventory-row" key={p.id}><div className="product-mini">{p.name.slice(0,1)}</div><div className="inventory-copy"><b>{p.name}</b><small>Inventory level</small></div><span className="stock-pill">{p.stock} left</span></div>)}</div><div className="panel"><div className="panel-heading"><div><h2>Store checklist</h2><p>Your launch essentials</p></div><span className="count-chip">{[!!store,!!categories.length,!!products.length,!!store?.is_published].filter(Boolean).length}/4</span></div>{[['Store details',!!store],['Categories',!!categories.length],['First product',!!products.length],['Publish storefront',!!store?.is_published]].map(([label,done]:any)=><div className="check-row" key={label}><span className={done?'check-icon done':'check-icon'}>{done?<Check size={13}/>:<span/>}</span><span>{label}</span><b>{done?'Done':'To do'}</b></div>)}<button className="btn secondary full" onClick={()=>setPage('setup')}>Continue setup <ArrowRight size={15}/></button></div></div>
        </section>}
        {page==='setup'&&<section className="page-content narrow-page"><div className="page-heading"><div><div className="eyebrow">START SOMETHING GOOD</div><h1>Create your store</h1><p>Set up the essentials first. You can refine the details later.</p></div><span className="step-count">STEP {Math.min(setupStep+1,4)} OF 4</span></div>{store&&<div className="panel public-url-panel"><div className="panel-heading"><div><h2>Your public store URL</h2><p>{store.is_published?'Your storefront is published.':'Publish the store in the final setup step to make it public.'}</p></div><Globe size={18}/></div><code className="public-url-value">{publicStoreUrl}</code><div className="button-row"><button className="btn primary" disabled={!store.is_published} onClick={()=>window.open(publicStoreUrl,'_blank','noopener,noreferrer')}><ExternalLink size={15}/> Visit Store</button><button className="btn secondary" onClick={copyStoreUrl}>Copy Store URL</button><button className="btn secondary" onClick={shareStoreUrl}>Share Store</button><button className="btn secondary" onClick={downloadStoreQr}>Download QR Code</button></div></div>}<div className="wizard-steps">{['Store details','Categories','Sample products','Theme & launch'].map((s,i)=><div key={s} className={`wizard-step ${setupStep===i?'current':setupStep>i?'complete':''}`}><span>{setupStep>i?<Check size={14}/>:i+1}</span><small>{s}</small></div>)}</div><div className="panel wizard-panel">
          {setupStep===0&&<form onSubmit={createStore}><div className="section-title"><h2>Tell us about your business</h2><p>A unique public URL is generated automatically from your store name.</p></div><div className="form-grid"><Field label="Store name *"><input required minLength={2} value={setup.name} onChange={e=>setSetup({...setup,name:e.target.value})} placeholder="e.g. Chetan's Corner"/></Field><div className="field"><label>Public URL</label><div className="muted">/{setup.name.toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'your-store'} (unique suffix added automatically if needed)</div></div><Field label="Business type *"><select value={setup.businessType} onChange={e=>setSetup({...setup,businessType:e.target.value})}>{['General retail','Groceries','Fashion & clothing','Electronics','Home & kitchen','Beauty & wellness','Agriculture','Other'].map(x=><option key={x}>{x}</option>)}</select></Field><Field label="Contact email *"><input required type="email" value={setup.email} onChange={e=>setSetup({...setup,email:e.target.value})} placeholder="you@business.com"/></Field><Field label="Phone number"><input value={setup.phone} onChange={e=>setSetup({...setup,phone:e.target.value})} placeholder="+91 98765 43210"/></Field><Field label="Street address"><input value={setup.address} onChange={e=>setSetup({...setup,address:e.target.value})} placeholder="Street and building"/></Field><Field label="City"><input value={setup.city} onChange={e=>setSetup({...setup,city:e.target.value})}/></Field><Field label="State / region"><input value={setup.region} onChange={e=>setSetup({...setup,region:e.target.value})}/></Field><Field label="Country"><input value={setup.country} onChange={e=>setSetup({...setup,country:e.target.value})}/></Field><Field label="Postal code"><input value={setup.postalCode} onChange={e=>setSetup({...setup,postalCode:e.target.value})}/></Field><Field label="Logo URL (optional)"><input type="url" value={logo} onChange={e=>setLogo(e.target.value)} placeholder="https://..."/></Field><Field label="Upload logo image"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>setLogoUpload(e.currentTarget.files?.[0]||null)}/></Field><Field label="Banner URL (optional)"><input type="url" value={bannerUrl} onChange={e=>setBannerUrl(e.target.value)} placeholder="https://..."/></Field><Field label="Upload banner image"><input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>setBannerUpload(e.currentTarget.files?.[0]||null)}/></Field><Field label="Short description"><input value={setup.description} onChange={e=>setSetup({...setup,description:e.target.value})} placeholder="What makes your store special?"/></Field></div><div className="wizard-footer"><span className="muted">Required fields are marked *</span><button className="btn primary" type="submit" disabled={loading}>Create store <ArrowRight size={16}/></button></div></form>}
          {setupStep===1&&<><div className="section-title"><h2>Choose your categories</h2><p>Pick categories that match your products. Add your own whenever you need.</p></div><div className="category-choice-grid">{[...new Set([...defaultCategories,...categoryNames])].map(c=><button key={c} className={`category-choice ${categoryNames.includes(c)?'chosen':''}`} onClick={()=>setCategoryNames(old=>old.includes(c)?old.filter(x=>x!==c):[...old,c])}><span className="category-choice-icon"><Tag size={18}/></span><span><b>{c}</b><small>{c==='Groceries'?'Food and daily essentials':c==='Electronics'?'Devices and accessories':c==='Clothing'?'Apparel and accessories':c==='Home & Kitchen'?'Useful things for home':'Custom product group'}</small></span><span className="choice-check">{categoryNames.includes(c)&&<Check size={13}/>}</span></button>)}</div><div className="inline-add"><input value={newCategory} onChange={e=>setNewCategory(e.target.value)} placeholder="Add a custom category"/><button className="btn secondary" onClick={()=>{const n=newCategory.trim();if(n&&!categoryNames.some(x=>x.toLowerCase()===n.toLowerCase()))setCategoryNames([...categoryNames,n]);setNewCategory('')}}><Plus size={15}/> Add</button></div><div className="wizard-footer"><button className="btn ghost" onClick={()=>setSetupStep(0)}><ArrowLeft size={15}/> Back</button><button className="btn primary" onClick={async()=>{if(await saveCategories())setSetupStep(2)}}>Save categories <ArrowRight size={15}/></button></div></>}
          {setupStep===2&&<><div className="section-title"><h2>Fill your shop in one click</h2><p>Generate realistic starter products for the selected categories. Review before publishing.</p></div><div className="sample-card"><div className="sample-illustration"><ShoppingBag size={35}/><span>+{categoryNames.length*2}</span></div><div><span className="badge green">SAMPLE CATALOGUE</span><h3>Start with sample products</h3><p>Up to two example products per supported category, with descriptions, prices, stock and image URLs.</p><button className="btn primary" onClick={seedProducts} disabled={loading}><Sparkles size={16}/> Import sample products</button></div></div><div className="import-box"><div className="import-box-icon"><FileSpreadsheet size={22}/></div><div><h3>Already have a product list?</h3><p>Download the CSV template, fill it in, then import it from Products & categories.</p><div className="button-row"><button className="text-btn" onClick={downloadTemplate}><ArrowDownToLine size={15}/> CSV template</button><button className="text-btn" onClick={downloadExcelTemplate}><ArrowDownToLine size={15}/> Excel template</button></div><button className="btn secondary" onClick={openCsvImport}><Upload size={15}/> Import CSV or Excel now</button></div></div><div className="wizard-footer"><button className="btn ghost" onClick={()=>setSetupStep(1)}><ArrowLeft size={15}/> Back</button><button className="btn primary" onClick={()=>setSetupStep(3)}>Choose a theme <ArrowRight size={15}/></button></div></>}
          {setupStep===3&&<><div className="section-title"><h2>Make it feel like your brand</h2><p>Pick a starting point. Colours and layout can be changed later.</p></div><div className="theme-grid">{themeOptions.map(t=><button key={t.id} className={`theme-card ${selectedTheme===t.id?'selected':''}`} onClick={()=>setSelectedTheme(t.id)}><div className="theme-mock" style={{background:t.bg}}><div className="mock-head" style={{background:t.color}}/><div className="mock-title" style={{background:t.color}}/><div className="mock-cards"><i/><i/><i/></div></div><div className="theme-card-copy"><div><b>{t.name}</b><small>{t.desc}</small></div>{selectedTheme===t.id&&<CheckCircle2 size={18}/>}</div></button>)}</div><div className="wizard-footer"><button className="btn ghost" onClick={()=>setSetupStep(2)}><ArrowLeft size={15}/> Back</button><div className="button-row"><button className="btn secondary" onClick={()=>saveTheme()}><Eye size={15}/> Save theme</button><button className="btn primary" onClick={async()=>{if(await saveTheme()&&await publishStore())setPage('storefront')}}>Publish store <Globe size={15}/></button></div></div></>}
        </div><div className="privacy-note"><CheckCircle2 size={15}/> Store data is sent to your Django API. Logo and banner image URLs are stored with the store profile; file uploads require a separate storage service.</div></section>}
        {page==='catalog'&&<section className="page-content"><div className="page-heading"><div><div className="eyebrow">YOUR INVENTORY</div><h1>Products & categories</h1><p>Manage product details, stock and pricing from one place.</p></div><div className="button-row"><button className="btn secondary" onClick={downloadTemplate}><ArrowDownToLine size={16}/> CSV template</button><button className="btn secondary" onClick={downloadExcelTemplate}><ArrowDownToLine size={16}/> Excel template</button><button className="btn secondary" onClick={()=>fileRef.current?.click()}><Upload size={16}/> Import CSV</button><button className="btn primary" onClick={()=>setProductModal(true)}><Plus size={16}/> Add product</button></div></div><div className="metric-grid compact"><Metric icon={<Package/>} label="Total products" value={String(products.filter(p=>!p.is_demo).length)} change="Real products from API" tone="green"/><Metric icon={<Tag/>} label="Categories" value={String(categories.length)} change="Store categories" tone="blue"/><Metric icon={<AlertIcon/>} label="Low stock" value={String(products.filter(p=>!p.is_demo&&p.stock<=(p.low_stock_threshold??5)).length)} change="At or below threshold" tone="red"/><Metric icon={<TrendingUp/>} label="Active products" value={String(products.filter(p=>p.is_active!==false).length)} change="Available in catalogue" tone="amber"/></div><div className="panel import-csv-panel"><div className="panel-heading"><div><h2>Import products from CSV</h2><p>Preview and validate rows before writing them to this store.</p></div><FileSpreadsheet size={19}/></div><input ref={fileRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={e=>{const file=e.currentTarget.files?.[0];if(file)void importCsv(file);e.currentTarget.value=''}}/><div className={`csv-dropzone ${csvDragging?'dragging':''}`} onDragOver={e=>{e.preventDefault();setCsvDragging(true)}} onDragLeave={()=>setCsvDragging(false)} onDrop={e=>{e.preventDefault();setCsvDragging(false);const file=e.dataTransfer.files?.[0];if(file)void importCsv(file)}}><CloudUpload size={25}/><b>Drop a CSV file here</b><span>or choose a file from your computer (up to 10 MB)</span><button className="btn secondary" type="button" onClick={()=>fileRef.current?.click()}>Choose CSV file</button><small>Required columns: name, price, stock, category. Optional: sku, description, image_url.</small></div><div className="csv-import-help"><span>Category values must match an existing category in this store. Add missing categories using the Categories list below before importing.</span><div className="button-row"><button className="text-btn" onClick={downloadTemplate}><ArrowDownToLine size={15}/> CSV template</button><button className="text-btn" onClick={downloadExcelTemplate}><ArrowDownToLine size={15}/> Excel template</button></div></div>{error&&<div className="alert error" role="alert">{error}</div>}{loading&&csvFileName&&<div className="import-loading" role="status">Validating {csvFileName}?</div>}{importPreview&&<><div className="import-preview-heading"><div><b>{csvFileName||'CSV preview'}</b><small>Showing up to {importPreview.preview.length} valid preview row(s)</small></div><div className="import-counts"><span className="valid-count">{importPreview.valid_rows} valid</span><span className={importPreview.failed_rows?'invalid-count':'valid-count'}>{importPreview.failed_rows} invalid</span></div></div>{importPreview.preview.length>0&&<div className="table-scroll csv-preview-table"><table><thead><tr><th>CSV row</th><th>Name</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th></tr></thead><tbody>{importPreview.preview.map((row,i)=><tr key={`${row.name}-${i}`}><td>{i+2}</td><td>{row.name}</td><td>{row.sku||'?'}</td><td>{row.category_name}</td><td>{row.price}</td><td>{row.stock}</td></tr>)}</tbody></table></div>}{importPreview.errors.length>0&&<div className="csv-errors" aria-live="polite"><b>Rows to fix</b>{importPreview.errors.map((item,i)=><div key={`${item.row}-${i}`}><strong>Row {item.row}{item.sku?` ? SKU ${item.sku}`:''}:</strong> {item.errors.join('; ')}</div>)}</div>}{importPreview.successful_rows>0&&<div className="alert success">Backend confirmed {importPreview.successful_rows} imported product(s). Product list refreshed from the API.</div>}{importPreview.valid_rows===0&&importPreview.successful_rows===0&&<div className="alert info">No valid rows to import. Fix the CSV errors and choose the file again.</div>}<div className="import-actions"><button className="btn ghost" onClick={cancelImport}>Cancel</button><button className="btn primary" disabled={loading||!pendingImportFile||importPreview.valid_rows===0} onClick={confirmImport}>{loading?'Importing?':`Confirm import ${importPreview.valid_rows} valid row(s)`}</button></div></>}</div><div className="panel catalog-panel"><div className="catalog-toolbar"><div className="search-box"><Search size={17}/><input value={productSearch} onChange={e=>setProductSearch(e.target.value)} placeholder="Search products or SKU"/></div><div className="toolbar-actions"><button className="btn secondary" onClick={seedProducts}><Sparkles size={15}/> Dummy import</button></div></div><div className="category-chips"><span>Categories</span>{categories.map(c=><button key={c.id} onClick={()=>setProductSearch(c.name)}>{c.name}</button>)}<button className="add-chip" onClick={async()=>{const name=window.prompt('New category name?');if(name&&store){const c=await run(()=>api.createCategory(store.slug,name),'Category added');if(c)setCategories(old=>[...old,c])}}}><Plus size={13}/> Add category</button></div><div className="table-scroll"><table><thead><tr><th>Product</th><th>SKU</th><th>Category</th><th>Price</th><th>Stock</th><th>Status</th><th></th></tr></thead><tbody>{filteredProducts.map(p=><tr key={p.id}><td><div className="product-cell">{p.image_url?<img src={p.image_url} alt="" onError={e=>{e.currentTarget.style.display='none'}}/>:<div className="product-placeholder"><ShoppingBag size={17}/></div>}<div><b>{p.name} {p.is_demo&&<span className="badge gray">Demo</span>}</b><small>{p.description||'No description'}</small></div></div></td><td><code>{p.sku||'—'}</code></td><td>{categories.find(c=>c.id===p.category)?.name||'Uncategorised'}</td><td><input className="table-edit price-edit" aria-label={`Price for ${p.name}`} defaultValue={String(p.price)} onBlur={e=>{if(e.target.value!==String(p.price))saveProductEdit(p,'price',e.target.value)}}/></td><td><input className={`table-edit stock-edit ${p.stock<=(p.low_stock_threshold??5)?'warning-stock':''}`} aria-label={`Stock for ${p.name}`} defaultValue={String(p.stock)} type="number" min="0" onBlur={e=>{if(e.target.value!==String(p.stock))saveProductEdit(p,'stock',e.target.value)}}/></td><td><span className={`status-pill ${p.is_active===false?'inactive':'active'}`}>{p.is_active===false?'Inactive':'Active'}</span></td><td><button className="icon-btn danger-icon" title="Delete product" onClick={()=>deleteProduct(p)}><Trash2 size={16}/></button></td></tr>)}</tbody></table>{filteredProducts.length===0&&<Empty icon={<Package/>} title="No matching products" text="Try another search or add a product to your catalogue."/>}</div></div>{importReport.length>0&&<div className="panel report-panel"><div className="panel-heading"><div><h2>Import report</h2><p>Rows accepted and rejected by validation</p></div><button className="icon-btn" onClick={()=>setImportReport([])}><X size={16}/></button></div>{importReport.map((line,i)=><div className={`report-line ${line.toLowerCase().includes('imported')?'good':''}`} key={i}>{line.toLowerCase().includes('imported')||line.toLowerCase().includes('preview:')?<CheckCircle2 size={15}/>:<X size={15}/>} {line}</div>)}{pendingImportFile&&<button className="btn primary" disabled={loading} onClick={confirmImport}>Confirm and import valid rows</button>}</div>}</section>}
        {page==='themes'&&<section className="page-content"><div className="page-heading"><div><div className="eyebrow">YOUR BRAND, YOUR RULES</div><h1>Find your store's look</h1><p>Choose from four distinct themes and preview before saving.</p></div><button className="btn primary" onClick={()=>saveTheme()}><Check size={16}/> Confirm theme</button></div><div className="panel theme-settings-panel"><div className="form-grid"><Field label="Primary colour"><input type="color" value={themeColor} onChange={e=>setThemeColor(e.target.value)}/></Field><Field label="Background colour"><input type="color" value={themeBg} onChange={e=>setThemeBg(e.target.value)}/></Field><Field label="Font"><select value={themeFont} onChange={e=>setThemeFont(e.target.value)}><option>Inter, sans-serif</option><option>Arial, sans-serif</option><option>Georgia, serif</option><option>system-ui, sans-serif</option></select></Field><Field label="Product layout"><select value={themeLayout} onChange={e=>setThemeLayout(e.target.value)}><option value="grid">Grid</option><option value="list">List</option></select></Field></div><div className="feature-tags">{[['hero','Hero'],['categories','Categories'],['products','Products'],['contact','Contact footer']].map(([id,label])=><label key={id}><input type="checkbox" checked={themeSections.includes(id)} onChange={e=>setThemeSections(old=>e.target.checked?[...old,id]:old.filter(x=>x!==id))}/> {label}</label>)}</div></div><div className="theme-workspace"><div className="theme-grid">{themeOptions.map(t=><button key={t.id} className={`theme-card ${selectedTheme===t.id?'selected':''}`} onClick={()=>setSelectedTheme(t.id)}><div className="theme-mock large" style={{background:t.bg}}><div className="mock-head" style={{background:t.color}}/><div className="mock-hero" style={{background:`linear-gradient(115deg,${t.color},${t.bg})`}}/><div className="mock-title" style={{background:t.color}}/><div className="mock-cards"><i/><i/><i/></div></div><div className="theme-card-copy"><div><b>{t.name}</b><small>{t.desc}</small></div>{selectedTheme===t.id&&<CheckCircle2 size={18}/>}</div></button>)}</div><div className={`panel live-preview theme-preview theme-${selectedTheme}`}><div className="preview-topline"><span><i/> LIVE PREVIEW</span><span className="preview-url">{store?`/${store.slug}`:'/your-store'}</span></div><div className="theme-preview-tabs">{([ ['home','Home'],['login','Login'],['signup','Signup'],['catalogue','Catalogue'],['product','Product'],['cart','Cart'],['checkout','Checkout'],['tracking','Tracking'] ] as [ThemePreviewPage,string][]).map(([id,label])=><button key={id} className={themePreviewPage===id?'active':''} onClick={()=>setThemePreviewPage(id)}>{label}</button>)}</div><div className="preview-browser"><div className="preview-nav" style={{background:theme.color}}><b>{store?.name||setup.name||'Your Store'}</b><span>Shop · About · Contact · <ShoppingCart size={15}/></span></div><div className="preview-hero" style={{background:theme.bg,display:themePreviewPage==='home'?'':'none'}}><div><span style={{color:theme.color}}>MADE FOR EVERYDAY</span><h2>Good finds.<br/>Good feelings.</h2><p>Discover the things you love, all in one place.</p><button style={{background:theme.color}}>Explore collection</button></div><div className="preview-circle" style={{background:theme.color}}><Leaf size={45}/></div></div><div className="preview-products" style={{display:themePreviewPage==='home'?'':'none'}}>{products.slice(0,3).map(p=><div key={p.id}><div className="preview-product-image">{p.image_url&&<img src={p.image_url} alt=""/>}</div><b>{p.name}</b><small>{money(p.price)}</small></div>)}</div>{themePreviewPage!=='home'&&<div className={`theme-page-demo theme-page-${themePreviewPage}`} style={{background:theme.bg,color:theme.color,fontFamily:themeFont}}><span className="eyebrow">{store?.name||setup.name||'Your Store'}</span>{themePreviewPage==='login'&&<><h3>Welcome back</h3><p>Sign in to your account</p><input placeholder="Email address"/><input placeholder="Password" type="password"/><button style={{background:theme.color,color:'#fff'}}>Sign in</button><small>Forgot password?</small></>}{themePreviewPage==='signup'&&<><h3>Create account</h3><p>Join {store?.name||'our store'}</p><input placeholder="Your name"/><input placeholder="Email address"/><input placeholder="Create password" type="password"/><button style={{background:theme.color,color:'#fff'}}>Create account</button></>}{themePreviewPage==='catalogue'&&<><h3>Shop all products</h3><div className="theme-demo-products">{products.slice(0,3).map(p=><div key={p.id}><div className="theme-demo-thumb">{p.image_url&&<img src={p.image_url} alt=""/>}</div><b>{p.name}</b><small>{money(p.price)}</small></div>)}</div></>}{themePreviewPage==='product'&&<><div className="theme-product-demo"><div className="theme-demo-thumb">{products[0]?.image_url&&<img src={products[0].image_url} alt=""/>}</div><div><small>PRODUCT DETAILS</small><h3>{products[0]?.name||'Product name'}</h3><p>{products[0]?.description||'Product description and details appear here.'}</p><b>{products[0]?money(products[0].price):money(0)}</b><button style={{background:theme.color,color:'#fff'}}>Add to cart</button></div></div></>}{themePreviewPage==='cart'&&<><h3>Your shopping cart</h3><div className="theme-demo-row"><span>{products[0]?.name||'Product'}</span><b>{products[0]?money(products[0].price):money(0)}</b></div><button style={{background:theme.color,color:'#fff'}}>Continue to checkout</button></>}{themePreviewPage==='checkout'&&<><h3>Checkout</h3><p>Delivery details</p><input placeholder="Full name"/><input placeholder="Address"/><input placeholder="City and PIN code"/><div className="theme-payment-choice">? UPI? ? Pay on delivery</div><button disabled title="Order placement is unavailable because the backend has no checkout endpoint." style={{background:theme.color,color:'#fff',opacity:.55,cursor:'not-allowed'}}>Checkout unavailable</button></>}{themePreviewPage==='tracking'&&<><h3>Track your order</h3><p>Sample tracking preview only. No real order has been placed.</p><div className="theme-tracking-steps"><span>? Placed</span><span>? Confirmed</span><span>? Out for delivery</span><span>? Delivered</span></div></>}</div>}</div><button className="btn primary full" onClick={()=>saveTheme()}>Use {theme.name} <ArrowRight size={15}/></button></div></div></section>}
        {page==='storefront'&&<section className="page-content"><div className="page-heading"><div><div className="eyebrow">CUSTOMER VIEW</div><h1>Your storefront</h1><p>Preview the shopping experience using your current store data.</p></div><div className="button-row">{store?.is_published&&<span className="status-pill active"><i/> Published</span>}<button className="btn primary" onClick={publishStore}><Globe size={16}/> Publish store</button></div></div><div className={`storefront-shell theme-${selectedTheme} layout-${themeLayout}`} style={{'--shop-accent':theme.color,'--shop-bg':theme.bg,fontFamily:themeFont} as React.CSSProperties}><div className="shop-top"><div className="shop-logo">{(store?.logo_image||store?.logo)?<img src={store.logo_image||store.logo} alt=""/>:<Leaf size={19}/>}<b>{store?.name||setup.name||'Your Store'}</b></div><div className="shop-links"><button onClick={()=>setStorefrontQuery('')}>Home</button><button onClick={()=>setStorefrontQuery('')}>All products</button><button onClick={()=>setPage('content')}>Contact</button><button className="cart-button" onClick={()=>setCartOpen(true)}><ShoppingCart size={16}/> Cart ({cartCount})</button></div></div>{themeSections.includes('hero')&&(store?.banner_image||store?.banner_url)&&<img className="store-banner" src={store.banner_image||store.banner_url} alt="Store banner"/>}<div className="shop-hero" style={{display:themeSections.includes('hero')?'':'none'}}><div><span className="badge green">A LITTLE SOMETHING GOOD</span><h2>{store?.name||setup.name||'Your store'}, made for you.</h2><p>{businessDescription||setup.description||'Thoughtful picks for your everyday life.'}</p><button className="btn primary" onClick={()=>document.getElementById('shop-products')?.scrollIntoView({behavior:'smooth'})}>Shop collection <ArrowRight size={16}/></button></div><div className="shop-hero-art"><div className="art-circle"><Leaf size={55}/></div><div className="art-card"><ShoppingBag size={25}/><b>Good things inside</b><small>Thoughtfully picked</small></div></div></div><div className="shop-category-row" style={{display:themeSections.includes('categories')?'':'none'}}>{storefrontCategories.map(c=><button key={c.id} onClick={()=>setStorefrontQuery(c.name)}>{c.name}<ArrowRight size={13}/></button>)}</div><div id="shop-products" className="shop-products-head" style={{display:themeSections.includes('products')?'':'none'}}><div><span className="eyebrow">THE COLLECTION</span><h2>Popular picks</h2></div><div className="search-box"><Search size={15}/><input value={storefrontQuery} onChange={e=>setStorefrontQuery(e.target.value)} placeholder="Search products"/></div></div><div className="shop-product-grid" style={{display:themeSections.includes('products')?'':'none'}}>{storefrontProducts.filter(p=>p.is_active!==false&&`${p.name} ${p.description||''} ${storefrontCategories.find(c=>c.id===p.category)?.name||''}`.toLowerCase().includes(storefrontQuery.toLowerCase())).map(p=><div className="shop-product-card" key={p.id}><div className="shop-product-img">{p.image_url?<img src={p.image_url} alt={p.name}/>:<ShoppingBag size={30}/>}<span>{p.stock>0?'IN STOCK':'OUT OF STOCK'}</span></div><div className="shop-product-info"><small>{storefrontCategories.find(c=>c.id===p.category)?.name||'Essentials'}</small><h3><button className="product-detail-link" onClick={async()=>{const detail=store?.is_published?await api.publicProduct(store.slug,p.id).catch(()=>p):p;setDetailProduct(detail)}}>{p.name}</button></h3><p>{p.description}</p><div><b>{money(p.price)}</b><button className="add-cart" disabled={p.stock<=0} onClick={()=>addToCart(p)}><Plus size={15}/> Add</button></div></div></div>)}</div>{storefrontProducts.length===0&&<Empty icon={<ShoppingBag/>} title="Your first products go here" text="Add products in the admin panel to populate this storefront."/>}<div className="shop-footer" style={{display:themeSections.includes('contact')?'':'none'}}><b>{store?.name||'Your Store'}</b><span>Contact {store?.contact_email||setup.email||'your store owner'}</span><small>Demo storefront preview. A public deployment domain and checkout service are separate setup tasks.</small></div></div><div className="privacy-note"><Globe size={15}/> Published stores load their actual public API data at <code>/api/public/stores/{store?.slug||'your-slug'}/</code>. This screen is a local preview; hosting and subdomain routing are not configured by this frontend.</div></section>}
        {page==='orders'&&<section className="page-content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">FULFILMENT</div>
              <h1>Orders</h1>
              <p>Saved orders and verified payment states from Django.</p>
            </div>
            <button className="btn secondary" onClick={async()=>{if(store){await loadStoreData(store)}api.myOrders().then(setMyOrders).catch(e=>setError(String(e)))}}>Refresh orders <ArrowRight size={15}/></button>
          </div>

          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>My customer orders</h2>
                <p>Orders placed by your signed-in account.</p>
              </div>
              <ShoppingBag size={18}/>
            </div>
            {myOrders.length ? myOrders.map(order => (
              <div className="section-row" key={`mine-${order.id}`}>
                <div>
                  <b>{order.order_number} · {order.store_name}</b>
                  <small>{order.items.map(item=>`${item.name} × ${item.quantity}`).join(', ')} · {order.created_at.slice(0,10)}</small>
                  <small>Fulfilment: {order.status} · Payment: {order.payment_status} ({order.payment_method.toUpperCase()}) · Total: {money(order.total)}</small>
                </div>
                {['placed','confirmed'].includes(order.status) && !['paid','authorized'].includes(order.payment_status) && (
                  <button className="btn ghost" onClick={()=>cancelMyOrder(order.order_number)}>Cancel</button>
                )}
              </div>
            )) : <Empty icon={<ClipboardList/>} title="No customer orders yet" text="Orders placed by this account will appear here."/>}
          </div>

          <div className="panel">
            <div className="panel-heading">
              <div>
                <h2>{store ? `${store.name} orders` : 'Store orders'}</h2>
                <p>Only orders for stores you can access are returned by the API.</p>
              </div>
              <span className="badge green">{orders.length} saved</span>
            </div>

            {orders.length ? (
              <div className="orders-container">
                {orders.map(order => (
                  <div className="order-card-modern" key={order.id}>
                    {/* 1. Header */}
                    <div className="order-card-header">
                      <div className="order-header-id">
                        <Package size={16} className="order-id-icon"/>
                        <span className="order-id-text">{order.order_number}</span>
                      </div>
                      <div className="order-header-badges">
                        <span className={`order-status-badge ${order.status}`}>{order.status}</span>
                        <span className={`order-payment-pill ${order.payment_status}`}>{order.payment_status}</span>
                      </div>
                    </div>

                    {/* 2. Customer Information */}
                    <div className="order-customer-section">
                      <span className="order-info-chip">
                        <User size={13}/>
                        <strong>{order.customer_name}</strong>
                      </span>
                      <span className="order-customer-divider">·</span>
                      <span className="order-info-chip">
                        <Phone size={13}/>
                        <span>{order.customer_phone}</span>
                      </span>
                      <span className="order-customer-divider">·</span>
                      <span className="order-info-chip">
                        <Calendar size={13}/>
                        <span>{order.created_at ? order.created_at.slice(0, 10) : ''}</span>
                      </span>
                    </div>

                    {/* 3. Products */}
                    <div className="order-products-section">
                      <div className="order-section-title">
                        <Package size={13}/> Products ({order.items.length})
                      </div>
                      <div className="order-products-table">
                        {order.items.map(item => (
                          <div className="order-product-row" key={item.id}>
                            <div className="order-product-main">
                              <span className="order-product-bullet">•</span>
                              <span className="order-product-title">{item.name}</span>
                            </div>
                            <div className="order-product-pricing">
                              <span className="order-product-qty">Qty: {item.quantity}</span>
                              <span className="order-product-unit">{money(item.unit_price)} each</span>
                              <span className="order-product-subtotal">{money(Number(item.unit_price) * item.quantity)}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 4. Delivery Address */}
                    <div className="order-address-section">
                      <div className="order-section-title">
                        <MapPin size={13}/> Delivery address
                      </div>
                      <div className="order-address-content">
                        <span>{[order.delivery_address?.line1, order.delivery_address?.city, order.delivery_address?.postal_code, order.delivery_address?.country].filter(Boolean).join(', ')}</span>
                      </div>
                    </div>

                    {/* 5. Footer */}
                    <div className="order-footer-bar">
                      <div className="order-footer-financials">
                        <div className="order-payment-method-box">
                          <CreditCard size={14}/>
                          <span>Payment:</span>
                          <strong>{order.payment_method.toUpperCase()}</strong>
                        </div>
                        <div className="order-total-amount-box">
                          <span className="order-total-amount-label">Total:</span>
                          <span className="order-total-amount-val">{money(order.total)}</span>
                        </div>
                      </div>
                      <div className="order-footer-actions">
                        <label className="order-status-dropdown-wrap">
                          <span>Fulfilment status</span>
                          <select
                            value={order.status}
                            onChange={e => updateOrder(order.order_number, e.target.value)}
                            aria-label={`Update fulfilment status for order ${order.order_number}`}
                          >
                            <option value={order.status}>{order.status}</option>
                            {(nextOrderStatuses[order.status] || []).map(s => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                        </label>
                        {order.payment_method === 'cod' && order.status === 'delivered' && order.payment_status === 'pending' && (
                          <button className="btn secondary small-btn order-cod-btn" onClick={() => collectCod(order.order_number)}>
                            Confirm COD collected
                          </button>
                        )}
                      </div>
                    </div>

                    {/* 6. Status History */}
                    <div className="order-history-drawer">
                      <span className="order-history-tag">Status history:</span>
                      {order.status_history && order.status_history.length > 0 ? (
                        <div className="order-history-chain">
                          {order.status_history.map((item, idx) => (
                            <span key={item.id || idx} className="order-history-node">
                              <span className="order-history-state">{item.to_status}</span>
                              <span className="order-history-time">({item.created_at ? item.created_at.slice(0, 10) : ''})</span>
                              {idx < order.status_history.length - 1 && <span className="order-history-arrow">→</span>}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="order-history-empty">No updates</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <Empty icon={<ClipboardList/>} title="No orders for this store" text="Customer orders will be listed here after checkout is completed."/>
            )}
          </div>
        </section>}
        {page==='content'&&<section className="page-content"><div className="page-heading"><div><div className="eyebrow">BRAND STUDIO</div><h1>Store customization</h1><p>Adjust your brand details without touching code.</p></div><button className="btn primary" onClick={()=>{setEditingContent(!editingContent);notify(editingContent?'Editor closed':'Edit mode enabled')}}><Settings2 size={16}/>{editingContent?'Close editor':'Edit store details'}</button></div><div className="content-editor-grid"><div className="panel"><div className="panel-heading"><div><h2>Brand details</h2><p>Changes to the fields below are saved to your store record.</p></div><StoreIcon size={18}/></div><div className="form-stack"><Field label="Store name"><input disabled={!editingContent} value={store?.name||setup.name} onChange={e=>setStore(store?{...store,name:e.target.value}:null)}/></Field><Field label="Contact email"><input disabled={!editingContent} value={store?.contact_email||setup.email} onChange={e=>setStore(store?{...store,contact_email:e.target.value}:null)}/></Field><Field label="Phone"><input disabled={!editingContent} value={store?.phone||setup.phone} onChange={e=>setStore(store?{...store,phone:e.target.value}:null)}/></Field><Field label="Logo URL"><input disabled={!editingContent} type="url" value={store?.logo||''} onChange={e=>setStore(store?{...store,logo:e.target.value}:null)}/></Field><Field label="Banner URL"><input disabled={!editingContent} type="url" value={store?.banner_url||''} onChange={e=>setStore(store?{...store,banner_url:e.target.value}:null)}/></Field><Field label="Upload or replace logo"><input disabled={!editingContent} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>setLogoUpload(e.currentTarget.files?.[0]||null)}/></Field><Field label="Upload or replace banner"><input disabled={!editingContent} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={e=>setBannerUpload(e.currentTarget.files?.[0]||null)}/></Field><Field label="Business information"><textarea disabled={!editingContent} value={businessDescription||setup.description} onChange={e=>setStore(store?{...store,business_info:{...(typeof store.business_info==='object'&&store.business_info?store.business_info:{}),description:e.target.value}}:null)}/></Field><div className="alert info"><CircleHelp size={16}/> Current Store API supports name, logo URL, contact details, business info, theme and theme settings. Image uploads are stored by the authenticated Django store asset endpoint. Section visibility and theme styling are saved; editable homepage block content remains a backend extension.</div><div className="button-row"><button className="btn primary" disabled={!editingContent||!store} onClick={saveStoreDetails}>Save details <Check size={15}/></button><button className="btn secondary" disabled={!editingContent||!store||(!logoUpload&&!bannerUpload)} onClick={uploadStoreImages}><Upload size={15}/> Upload images</button></div></div></div><div className="panel"><div className="panel-heading"><div><h2>Homepage sections</h2><p>Proposed no-code content blocks</p></div><Plus size={18}/></div>{[['hero','Hero banner','Store introduction, banner and call to action'],['categories','Category tiles','Show the saved store categories'],['products','Featured products','Show active products from the store catalogue'],['contact','Contact & footer','Show store contact information']].map(([key,label,description])=><div className="section-row" key={key}><div className="section-row-icon"><LayoutDashboard size={16}/></div><div><b>{label}</b><small>{description}</small></div><button className="btn secondary" onClick={()=>toggleHomeSection(key)}>{themeSections.includes(key)?'Remove':'Add section'}</button></div>)}<p className="muted tiny">Section visibility is saved to this store's theme settings and reflected in its preview. Custom page-block content is not yet supported.</p></div></div></section>}
        {page==='assistant'&&<section className="page-content assistant-page"><div className="page-heading"><div><div className="eyebrow">STORE-SCOPED INTELLIGENCE</div><h1>Your business, in plain language</h1><p>Ask questions about your store. Answers must come from real data, not guesses.</p></div><span className="ai-status"><i/> {store?'Secure, store-scoped API':'Connect a store'}</span></div><div className="assistant-layout"><div className="panel chat-panel"><label className="assistant-store-select">Selected store<select aria-label="Select assistant store" value={store?.slug||''} disabled={!stores.length||chatLoading} onChange={async e=>{const selected=stores.find(s=>s.slug===e.target.value);if(selected){await loadStoreData(selected);setChat([{role:'assistant',text:`Selected ${selected.name}. Ask a question about this store's inventory.`}]);setRetryQuestion('')}}}><option value="">Select a store</option>{stores.map(s=><option key={s.id} value={s.slug}>{s.name}</option>)}</select></label><div className="chat-heading"><div className="bot-avatar"><Bot size={21}/></div><div><b>SmartStore assistant</b><small><i/> Store context: {store?.slug||'not connected'}</small></div><span className="badge green">Data-aware</span></div><div className="chat-messages">{chat.map((m,i)=><div key={i} className={`chat-message ${m.role}`}><div className="message-avatar">{m.role==='assistant'?<Sparkles size={15}/>:<Users size={15}/>}</div><div className="message-body"><p>{m.text}</p>{m.source&&<div className="source-box"><b><CheckCircle2 size={13}/> Data behind this answer</b><small>{m.source}</small></div>}</div></div>)}</div>{chatLoading&&<div className="chat-message assistant"><div className="message-avatar"><Sparkles size={15}/></div><div className="message-body"><p>Checking your store data...</p></div></div>}{retryQuestion&&<button className="text-btn" onClick={()=>sendAssistantQuestion(retryQuestion,false)}>Retry last question</button>}<div className="suggested-prompts">{['Which products are low on stock?','What is my revenue and order count?','What are my top 5 selling products this month?'].map(q=><button key={q} onClick={()=>setChatInput(q)}>{q}<ArrowRight size={13}/></button>)}</div><form className="chat-input-row" onSubmit={askAssistant}><input value={chatInput} onChange={e=>setChatInput(e.target.value)} placeholder="Ask about your store data..." aria-label="Question"/><button className="btn primary" disabled={!chatInput.trim()||chatLoading}>{chatLoading?'...':<ArrowRight size={17}/>}</button></form><div className="chat-disclaimer"><CheckCircle2 size={13}/> Read-only design. The AI endpoint must enforce tenant scope and database query restrictions on the server.</div></div><div className="assistant-side"><div className="panel"><div className="panel-heading"><div><h2>Things I can help with</h2><p>Based on connected store data</p></div><Sparkles size={18}/></div>{[['Inventory health','Low stock and items to reorder'],['Sales summary','Saved order counts and order values; currency is unconfigured'],['Product performance','Top five products from saved order line items this month'],['Weekly comparison','Current and previous week with exact date ranges']].map(([a,b])=><div className="capability-row" key={a}><span><Check size={14}/></span><div><b>{a}</b><small>{b}</small></div></div>)}</div><div className="panel safety-card"><div className="safety-icon"><ShieldIcon/></div><h3>Honest by design</h3><p>Assistant uses the selected store slug, shows data sources where available and says when the API does not contain an answer.</p><ul><li>Read-only requests</li><li>Store-scoped context</li><li>No invented sales figures</li></ul></div></div></div></section>}
        {page==='settings'&&<section className="page-content"><div className="page-heading"><div><div className="eyebrow">WORKSPACE SETTINGS</div><h1>Connection settings</h1><p>Manage the frontend connection to your existing Django REST API.</p></div></div><div className="panel settings-panel"><div className="setting-row"><div><b>API base URL</b><p>Configured through VITE_API_BASE_URL in your .env file.</p></div><code>{import.meta.env.VITE_API_BASE_URL||'http://127.0.0.1:8000/api'}</code></div><div className="setting-row"><div><b>Authentication</b><p>JWT access token with refresh attempt on 401.</p></div><span className={`status-pill ${hasToken()?'active':'inactive'}`}>{hasToken()?'Token stored':'Not signed in'}</span></div><div className="setting-row"><div><b>Current store</b><p>Data requests are scoped by the selected store slug.</p></div><code>{store?.slug||'No store selected'}</code></div><div className="setting-row"><div><b>AI endpoint</b><p>Authenticated Django endpoint; provider credentials stay on the backend.</p></div><span className={`status-pill ${hasToken()?'active':'inactive'}`}>{hasToken()?'JWT protected':'Sign in required'}</span></div><div className="alert info"><CircleHelp size={16}/> In production, serve the frontend over HTTPS, configure Django CORS for the exact frontend origin, and keep secrets on the server. Never place an AI provider API key in Vite environment variables.</div><button className="btn secondary" onClick={signOut}><LogOut size={16}/> Sign out</button></div></section>}
      </div>
      <footer className="app-footer"><span>© 2026 SmartStore AI</span><span><i/> Built for growing businesses</span><span>Commerce workspace · v1.0</span></footer>
    </main>
    {cartOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setCartOpen(false)}}><div className="modal"><div className="modal-head"><div><h2>Your cart</h2><p>Cart for {store?.name||'the selected store'}. Sign in is required before checkout.</p></div><button className="icon-btn" aria-label="Close cart" onClick={()=>setCartOpen(false)}><X size={18}/></button></div>{cart.length?cart.map(line=><div className="section-row" key={line.product.id}><div><b>{line.product.name}</b><small>{money(line.product.price)} each · {line.product.stock} in stock</small></div><button className="btn ghost" aria-label={`Remove one ${line.product.name}`} onClick={()=>changeCartQuantity(line.product.id,line.quantity-1)}>−</button><b>{line.quantity}</b><button className="btn ghost" aria-label={`Add one ${line.product.name}`} disabled={line.quantity>=line.product.stock} onClick={()=>changeCartQuantity(line.product.id,line.quantity+1)}>+</button><b>{money(Number(line.product.price)*line.quantity)}</b></div>):<Empty icon={<ShoppingCart/>} title="Your cart is empty" text="Add an in-stock product from the preview to see it here."/>}<div className="modal-actions"><b>Subtotal estimate: {money(cartSubtotal)}</b><button className="btn primary" disabled={!cart.length||checkoutBusy} onClick={startCheckout}>{checkoutBusy?'Loading?':'Continue to checkout'} <ArrowRight size={15}/></button></div>{checkoutError&&<div className="alert error">{checkoutError}</div>}<p className="muted tiny">The server will recheck product prices and stock and calculate the final total during checkout. Delivery charge: {checkoutConfig?money(checkoutConfig.delivery_charge):'shown at checkout'}.</p></div></div>}
    {checkoutOpen&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!checkoutBusy)setCheckoutOpen(false)}}><form className="modal" onSubmit={placeOrder}><div className="modal-head"><div><h2>Checkout</h2><p>Signed in as {userEmail}. Prices and stock are verified by the store server.</p></div><button type="button" className="icon-btn" disabled={checkoutBusy} onClick={()=>setCheckoutOpen(false)}><X size={18}/></button></div><div className="form-grid"><Field label="Customer name"><input required maxLength={180} value={checkoutForm.customer_name} onChange={e=>setCheckoutForm({...checkoutForm,customer_name:e.target.value})}/></Field><Field label="Phone number"><input required type="tel" pattern="[+]?[0-9][0-9\s\-]{7,20}" value={checkoutForm.customer_phone} onChange={e=>setCheckoutForm({...checkoutForm,customer_phone:e.target.value})}/></Field><Field label="Delivery address"><input required value={checkoutForm.line1} onChange={e=>setCheckoutForm({...checkoutForm,line1:e.target.value})} placeholder="Street address"/></Field><Field label="City"><input required value={checkoutForm.city} onChange={e=>setCheckoutForm({...checkoutForm,city:e.target.value})}/></Field><Field label="Postal code"><input required value={checkoutForm.postal_code} onChange={e=>setCheckoutForm({...checkoutForm,postal_code:e.target.value})}/></Field><Field label="Country"><input required value={checkoutForm.country} onChange={e=>setCheckoutForm({...checkoutForm,country:e.target.value})}/></Field></div><div className="panel"><b>Order summary</b>{cart.map(line=><div className="section-row" key={line.product.id}><span>{line.product.name}</span><span>{line.quantity} × {money(line.product.price)}</span><b>{money(Number(line.product.price)*line.quantity)}</b></div>)}<div className="setting-row"><b>Subtotal estimate</b><b>{money(cartSubtotal)}</b></div><div className="setting-row"><span>Delivery charge</span><span>{money(checkoutConfig?.delivery_charge||0)}</span></div><div className="setting-row"><b>Estimated total</b><b>{money(cartSubtotal+Number(checkoutConfig?.delivery_charge||0))} {checkoutConfig?.currency}</b></div></div><div className="form-stack"><b>Payment method</b><label className="setting-row"><span><input type="radio" name="payment" checked={paymentMethod==='cod'} onChange={()=>setPaymentMethod('cod')}/> Cash on Delivery (available)</span></label><label className="setting-row"><span><input type="radio" name="payment" checked={paymentMethod==='razorpay'} disabled={!checkoutConfig?.payment_methods.razorpay} onChange={()=>setPaymentMethod('razorpay')}/> Credit/debit card through Razorpay test checkout</span><small>{checkoutConfig?.payment_methods.razorpay?'Razorpay test mode':'Razorpay test credentials are not configured; use COD.'}</small></label></div>{checkoutError&&<div className="alert error" role="alert">{checkoutError}</div>}<div className="modal-actions"><button type="button" className="btn ghost" disabled={checkoutBusy} onClick={()=>setCheckoutOpen(false)}>Cancel</button><button className="btn primary" disabled={checkoutBusy||!cart.length||(paymentMethod==='razorpay'&&!checkoutConfig?.payment_methods.razorpay)}>{checkoutBusy?'Processing…':paymentMethod==='cod'?'Place COD order':'Continue to secure payment'} <ArrowRight size={15}/></button></div><p className="muted tiny">Final totals are calculated by Django. Card information is entered only in Razorpay Checkout; SmartStore does not store card numbers or CVVs.</p></form></div>}
    {checkoutResult&&<div className="modal-backdrop"><div className="modal"><div className="modal-head"><div><h2>Order saved</h2><p>Order number <strong>{checkoutResult.order_number}</strong></p></div><CheckCircle2 size={22}/></div><p>Fulfilment: {checkoutResult.status}. Payment: {checkoutResult.payment_status} via {checkoutResult.payment_method}.</p><p>Total: {money(checkoutResult.total)} {checkoutResult.currency}</p><div className="modal-actions"><button className="btn secondary" onClick={()=>{setCheckoutResult(null);setPage('orders')}}>View my orders</button><button className="btn primary" onClick={()=>setCheckoutResult(null)}>Done</button></div></div></div>}
    {productModal&&<div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setProductModal(false)}}><div className="modal"><div className="modal-head"><div><h2>Add a product</h2><p>Add product details to your live Django catalogue.</p></div><button className="icon-btn" onClick={()=>setProductModal(false)}><X size={18}/></button></div><div className="form-grid"><Field label="Product name *"><input value={newProduct.name} onChange={e=>setNewProduct({...newProduct,name:e.target.value})} placeholder="Product name"/></Field><Field label="SKU *"><input value={newProduct.sku} onChange={e=>setNewProduct({...newProduct,sku:e.target.value})} placeholder="e.g. PROD-001"/></Field><Field label="Price (₹) *"><input type="number" min="0" step="0.01" value={newProduct.price} onChange={e=>setNewProduct({...newProduct,price:e.target.value})} placeholder="0.00"/></Field><Field label="Stock *"><input type="number" min="0" value={newProduct.stock} onChange={e=>setNewProduct({...newProduct,stock:e.target.value})} placeholder="0"/></Field><Field label="Category"><select value={newProduct.category} onChange={e=>setNewProduct({...newProduct,category:e.target.value})}><option value="">Uncategorised</option>{categories.map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></Field><Field label="Image URL"><input value={newProduct.image_url} onChange={e=>setNewProduct({...newProduct,image_url:e.target.value})} placeholder="https://..."/></Field><div className="field full-field"><label>Description</label><textarea value={newProduct.description} onChange={e=>setNewProduct({...newProduct,description:e.target.value})} placeholder="Short product description"/></div></div><div className="modal-actions"><button className="btn ghost" onClick={()=>setProductModal(false)}>Cancel</button><button className="btn primary" onClick={createOneProduct} disabled={loading}>Save product <Check size={15}/></button></div></div></div>}
    {toast&&<div className="toast"><CheckCircle2 size={16}/>{toast}</div>}
  </div>
}
function AuthScreen({ onAuthenticated }: { onAuthenticated: (email: string) => void }) {
  const [registerMode, setRegisterMode] = useState(false)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      if (registerMode) {
        if (username.trim().length < 2) {
          setError('Enter a username of at least 2 characters.')
          setLoading(false)
          return
        }
        if (password.length < 8) {
          setError('Password must be at least 8 characters.')
          setLoading(false)
          return
        }
        await api.register(username.trim(), email.trim(), password)
      }
      const data = await api.login(email.trim(), password)
      if (data?.access) {
        onAuthenticated(email.trim())
      } else {
        setError('Authentication failed. Please verify your credentials.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-backdrop login-backdrop" style={{ position: 'fixed', inset: 0 }}>
      <form className="modal login-modal" onSubmit={handleSubmit}>
        <div className="login-brand">
          <div className="brand-icon"><Leaf size={24}/></div>
          <span>smartstore<span>.ai</span></span>
        </div>
        {error && <div className="alert error" role="alert">{error}</div>}
        <div className="login-heading">
          <h2>{registerMode ? 'Create your account' : 'Welcome back'}</h2>
          <p>{registerMode ? 'Register a SmartStore workspace account.' : 'Sign in to access your store workspace.'}</p>
        </div>
        {registerMode && (
          <Field label="Username">
            <input
              required
              minLength={2}
              value={username}
              onChange={e => setUsername(e.target.value)}
              autoComplete="username"
              placeholder="Your username"
            />
          </Field>
        )}
        <Field label="Email address">
          <input
            required
            type="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            placeholder="owner@store.com"
            autoComplete="email"
          />
        </Field>
        <Field label="Password">
          <input
            required
            minLength={registerMode ? 8 : 1}
            autoComplete={registerMode ? 'new-password' : 'current-password'}
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Your password"
          />
        </Field>
        <button className="btn primary full" disabled={loading} type="submit">
          {loading ? 'Connecting…' : registerMode ? 'Create account' : 'Sign in to workspace'}{' '}
          <ArrowRight size={16}/>
        </button>
        <p className="login-help">
          Protected with JWT authentication and rate limiting.
        </p>
        <button
          type="button"
          className="text-btn centered"
          onClick={() => { setRegisterMode(!registerMode); setError('') }}
        >
          {registerMode ? 'Already registered? Sign in' : 'New user? Create an account'}
        </button>
      </form>
    </div>
  )
}

function App(){
  const [pathname,setPathname]=useState(()=>window.location.pathname)
  const [authenticated,setAuthenticated]=useState(hasToken())
  const [userEmail,setUserEmail]=useState('')

  useEffect(()=>{
    const onPop=()=>setPathname(window.location.pathname)
    const onSync=()=>setAuthenticated(hasToken())
    window.addEventListener('popstate',onPop)
    window.addEventListener('storage',onSync)
    window.addEventListener('smartstore:auth-expired',onSync)
    return()=>{
      window.removeEventListener('popstate',onPop)
      window.removeEventListener('storage',onSync)
      window.removeEventListener('smartstore:auth-expired',onSync)
    }
  },[])

  if(/^\/store(?:\/|$)/i.test(pathname)){
    let slug=''
    try{slug=decodeURIComponent(pathname.split('/')[2]||'')}catch{slug='__invalid_store_slug__'}
    return <PublicStorefront slug={slug}/>
  }

  if(!authenticated){
    return <AuthScreen onAuthenticated={(email)=>{setUserEmail(email);setAuthenticated(true)}}/>
  }

  return <WorkspaceApp onSignOut={()=>{logout();setAuthenticated(false)}} initialEmail={userEmail}/>
}
function Metric({icon,label,value,change,tone}:{icon:React.ReactNode;label:string;value:string;change:string;tone:string}){return <div className="metric-card"><div className={`metric-icon ${tone}`}>{icon}</div><div className="metric-label">{label}</div><div className="metric-value">{value}</div><div className="metric-change">{change}</div></div>}
function Field({label,children}:{label:string;children:React.ReactNode}){return <div className="field"><label>{label}</label>{children}</div>}
function QuickAction({icon,title,detail,onClick}:{icon:React.ReactNode;title:string;detail:string;onClick:()=>void}){return <button className="quick-action" onClick={onClick}><span className="quick-action-icon">{icon}</span><span><b>{title}</b><small>{detail}</small></span><ArrowRight size={15}/></button>}
function Empty({icon,title,text}:{icon:React.ReactNode;title:string;text:string}){return <div className="empty-state"><div>{icon}</div><b>{title}</b><p>{text}</p></div>}
function AlertIcon(){return <Activity/>}
function ShieldIcon(){return <CheckCircle2 size={22}/>}
export default App

