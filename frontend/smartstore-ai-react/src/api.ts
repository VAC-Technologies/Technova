const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000/api').replace(/\/$/, '')

export type Store = {
  id: number; name: string; slug: string; logo?: string; logo_image?: string; banner_url?: string; banner_image?: string; contact_email?: string; phone?: string;
  business_info?: string | Record<string, unknown>; theme: string; theme_settings?: Record<string, unknown>; is_published: boolean
}
export type Category = { id: number; name: string }
export type Product = {
  id: number; category: number | null; name: string; description?: string; sku?: string;
  price: string | number; stock: number; low_stock_threshold?: number; image_url?: string;
  is_active?: boolean; is_demo?: boolean
}
export type Analytics = { period_days: number; revenue: string; orders: number; pending_orders: number; low_stock: {id:number;name:string;stock:number}[] }
export type PublicStore = Omit<Store,'id'|'is_published'> & { id?:number; is_published?:boolean; logo_image?:string; banner_image?:string; categories:Category[]; products:Product[] }
export type OrderItem = {id:number;product:number;name:string;quantity:number;unit_price:string}
export type Order = {id:number;order_number:string;store:number;store_name:string;store_slug:string;customer:number|null;customer_name:string;customer_phone:string;delivery_address:Record<string,string>;status:'placed'|'confirmed'|'processing'|'shipped'|'delivered'|'cancelled';payment_method:'cod'|'razorpay'|'legacy';payment_status:'pending'|'authorized'|'paid'|'failed'|'cancelled'|'refunded'|'unknown';currency:string;subtotal:string|null;delivery_charge:string|null;total:string;items:OrderItem[];status_history:{id:number;from_status:string;to_status:string;created_at:string;note:string}[];created_at:string;updated_at:string}
export type CheckoutConfig = {currency:string;delivery_charge:string;payment_methods:{cod:boolean;razorpay:boolean}}

let accessToken = localStorage.getItem('ss_access') || ''
let refreshToken = localStorage.getItem('ss_refresh') || ''
let refreshInFlight: Promise<boolean> | null = null
export function hasToken() { return Boolean(accessToken) }
export function saveTokens(access: string, refresh: string) {
  accessToken = access; refreshToken = refresh
  localStorage.setItem('ss_access', access); localStorage.setItem('ss_refresh', refresh)
}
export function logout() {
  const currentRefresh = refreshToken || localStorage.getItem('ss_refresh') || ''
  const currentAccess = accessToken || localStorage.getItem('ss_access') || ''
  accessToken = ''; refreshToken = ''
  localStorage.removeItem('ss_access'); localStorage.removeItem('ss_refresh')
  if (currentRefresh) {
    fetch(`${API_BASE}/auth/logout/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(currentAccess ? { 'Authorization': `Bearer ${currentAccess}` } : {})
      },
      body: JSON.stringify({ refresh: currentRefresh })
    }).catch(() => {
      // Best-effort server blacklist on logout
    })
  }
}
window.addEventListener('storage', event => {
  if (event.key === 'ss_access' || event.key === 'ss_refresh' || event.key === null) {
    accessToken = localStorage.getItem('ss_access') || ''
    refreshToken = localStorage.getItem('ss_refresh') || ''
    if (!accessToken && !refreshToken) window.dispatchEvent(new Event('smartstore:auth-expired'))
  }
})

function expireSession(expectedRefresh?:string) {
  if (expectedRefresh && localStorage.getItem('ss_refresh') !== expectedRefresh) {
    accessToken=localStorage.getItem('ss_access')||''
    refreshToken=localStorage.getItem('ss_refresh')||''
    return
  }
  const hadSession = Boolean(accessToken || refreshToken || localStorage.getItem('ss_access') || localStorage.getItem('ss_refresh'))
  logout()
  if (hadSession) window.dispatchEvent(new Event('smartstore:auth-expired'))
}

async function refreshAccessToken(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    const currentRefresh = localStorage.getItem('ss_refresh') || refreshToken
    if (!currentRefresh) { expireSession(); return false }
    let response: Response
    try {
      response = await fetch(`${API_BASE}/auth/refresh/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh: currentRefresh })
      })
    } catch {
      throw new Error(`Could not reach the API at ${API_BASE}. Check that Django is running and CORS allows this frontend origin.`)
    }
    if (!response.ok) { expireSession(currentRefresh); return false }
    let data: {access?:string;refresh?:string}
    try { data = await response.json() } catch { expireSession(currentRefresh); return false }
    if (!data.access) { expireSession(currentRefresh); return false }
    if (localStorage.getItem('ss_refresh') !== currentRefresh) {
      accessToken=localStorage.getItem('ss_access')||''
      refreshToken=localStorage.getItem('ss_refresh')||''
      return Boolean(accessToken)
    }
    saveTokens(data.access, data.refresh || currentRefresh)
    return true
  })().finally(() => { refreshInFlight = null })
  return refreshInFlight
}

async function send(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers)
  const hasBody = options.body !== undefined && options.body !== null
  if (hasBody && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  const authEndpoint = path.startsWith('/auth/login/') || path.startsWith('/auth/register/') || path.startsWith('/auth/refresh/')
  const storedAccess = localStorage.getItem('ss_access') || ''
  if (storedAccess !== accessToken) accessToken = storedAccess
  if (accessToken && !authEndpoint) headers.set('Authorization', `Bearer ${accessToken}`)
  else headers.delete('Authorization')
  try { return await fetch(`${API_BASE}${path}`, { ...options, headers }) }
  catch { throw new Error(`Could not reach the API at ${API_BASE}. Check that Django is running and CORS allows this frontend origin.`) }
}

async function responseData<T>(response: Response): Promise<T> {
  const raw = await response.text()
  let data: any = null
  try { data = raw ? JSON.parse(raw) : null } catch { data = raw }
  if (!response.ok) {
    const detail = data?.detail || (typeof data === 'object' ? JSON.stringify(data) : data) || `HTTP ${response.status}`
    throw new Error(`${response.status}: ${detail}`)
  }
  return data as T
}
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const authEndpoint = path.startsWith('/auth/login/') || path.startsWith('/auth/register/') || path.startsWith('/auth/refresh/')
  let response = await send(path, options)
  if (response.status === 401 && !authEndpoint) {
    const hasRefresh = Boolean(localStorage.getItem('ss_refresh') || refreshToken)
    if (hasRefresh && await refreshAccessToken()) response = await send(path, options)
    else if (!hasRefresh) expireSession()
  }
  return responseData<T>(response)
}
async function requestBlob(path:string):Promise<Blob> {
  let response=await send(path)
  if(response.status===401) {
    const hasRefresh=Boolean(localStorage.getItem('ss_refresh')||refreshToken)
    if(hasRefresh&&await refreshAccessToken()) response=await send(path)
    else if(!hasRefresh) expireSession()
  }
  if(!response.ok) throw new Error(`${response.status}: Could not download the Excel template.`)
  return response.blob()
}
export const api = {
  register: (username:string, email:string, password:string) => request<{id:number;username:string;email:string}>('/auth/register/', { method:'POST', body:JSON.stringify({username,email,password}) }),
  login: async (email: string, password: string) => {
    const data = await request<{access:string;refresh:string}>('/auth/login/', { method:'POST', body: JSON.stringify({ email, password }) })
    saveTokens(data.access, data.refresh); return data
  },
  me: () => request<{id:number;username:string;email:string}>('/auth/me/'),
  stores: () => request<Store[] | {results:Store[]}>('/stores/'),
  slugAvailability: (slug:string) => request<{slug:string;available:boolean}>(`/stores/slug-availability/?slug=${encodeURIComponent(slug)}`),
  createStore: (payload: Record<string, unknown>) => request<Store>('/stores/', { method:'POST', body:JSON.stringify(payload) }),
  uploadStoreAssets: async (id:number, logo:File|null, banner:File|null) => { const form=new FormData(); if(logo)form.append('logo_image',logo); if(banner)form.append('banner_image',banner); return request<Store>(`/stores/${id}/assets/`,{method:'POST',body:form}) },
  updateStore: (id: number, payload: Record<string, unknown>) => request<Store>(`/stores/${id}/`, { method:'PATCH', body:JSON.stringify(payload) }),
  categories: (slug:string) => request<Category[]>(`/stores/${slug}/categories/`),
  createCategory: (slug:string, name:string) => request<Category>(`/stores/${slug}/categories/`, { method:'POST', body:JSON.stringify({name}) }),
  bulkCategories: (slug:string, categories:string[]) => request<{created:number}>(`/stores/${slug}/categories/bulk/`, { method:'POST', body:JSON.stringify({categories:categories.map(name=>({name}))}) }),
  products: (slug:string) => request<Product[]>(`/stores/${slug}/products/`),
  importProducts: async (slug:string, file:File, commit:boolean) => { const form=new FormData(); form.append('file',file); form.append('commit',String(commit)); return request<{preview_only:boolean;total_validated:number;successful_rows:number;valid_rows:number;failed_rows:number;errors:{row:number;sku?:string;errors:string[]}[];preview:{name:string;sku?:string|null;price:string;stock:number;category_name:string;description?:string;image_url?:string}[];products:Product[]}>(`/stores/${slug}/products/import/`, {method:'POST',body:form}) },
  downloadXlsxTemplate: (slug:string) => requestBlob(`/stores/${slug}/products/import/template/`),
  createProduct: (slug:string, p:Record<string,unknown>) => request<Product>(`/stores/${slug}/products/`, { method:'POST', body:JSON.stringify(p) }),
  updateProduct: (slug:string,id:number,p:Record<string,unknown>) => request<Product>(`/stores/${slug}/products/${id}/`, { method:'PATCH', body:JSON.stringify(p) }),
  deleteProduct: (slug:string,id:number) => request<void>(`/stores/${slug}/products/${id}/`, { method:'DELETE' }),
  themes: (slug:string) => request<{themes:string[];selected:string;settings:Record<string,unknown>}>(`/stores/${slug}/theme/`),
  updateTheme: (slug:string, theme:string, settings:Record<string,unknown>={}) => request<{theme:string}>(`/stores/${slug}/theme/`, { method:'PATCH', body:JSON.stringify({theme,theme_settings:settings}) }),
  publish: (slug:string) => request<{slug:string;url_path:string;is_published:boolean}>(`/stores/${slug}/publish/`, { method:'POST', body:JSON.stringify({}) }),
  analytics: (slug:string) => request<Analytics>(`/stores/${slug}/analytics/`),
  aiChat: (slug:string, question:string) => request<{answer:string;store_slug:string;evidence:Record<string,unknown>}>(`/ai/chat/`, {method:'POST',body:JSON.stringify({store_slug:slug,question})}),
  publicStore: (slug:string) => request<PublicStore>(`/public/stores/${slug}/`),
  publicProduct: (slug:string,id:number) => request<Product>(`/public/stores/${slug}/products/${id}/`),
  checkoutConfig: (slug:string) => request<CheckoutConfig>(`/public/stores/${slug}/checkout/config/`),
  checkout: (slug:string,payload:Record<string,unknown>,idempotencyKey:string) => request<Order>(`/public/stores/${slug}/checkout/`,{method:'POST',headers:{'Idempotency-Key':idempotencyKey},body:JSON.stringify(payload)}),
  createPayment: (orderNumber:string) => request<{order_number:string;razorpay_order_id:string;key_id:string;amount:number;currency:string}>(`/orders/${orderNumber}/payment/create/`,{method:'POST',body:JSON.stringify({})}),
  verifyPayment: (orderNumber:string,payload:Record<string,string>) => request<Order>(`/orders/${orderNumber}/payment/verify/`,{method:'POST',body:JSON.stringify(payload)}),
  failPayment: (orderNumber:string) => request<Order>(`/orders/${orderNumber}/payment/fail/`,{method:'POST',body:JSON.stringify({})}),
  myOrders: () => request<Order[]>('/orders/my/'),
  customerOrder: (orderNumber:string) => request<Order>(`/orders/my/${encodeURIComponent(orderNumber)}/`),
  cancelMyOrder: (orderNumber:string) => request<Order>(`/orders/my/${encodeURIComponent(orderNumber)}/cancel/`,{method:'POST',body:JSON.stringify({})}),
  storeOrders: (slug:string) => request<Order[]>(`/stores/${slug}/orders/`),
  updateOrderStatus: (slug:string,orderNumber:string,nextStatus:string) => request<Order>(`/stores/${slug}/orders/${encodeURIComponent(orderNumber)}/status/`,{method:'PATCH',body:JSON.stringify({status:nextStatus})}),
  collectCodPayment: (slug:string,orderNumber:string) => request<Order>(`/stores/${slug}/orders/${encodeURIComponent(orderNumber)}/payment/collect/`,{method:'POST',body:JSON.stringify({})})
}
export { API_BASE }



