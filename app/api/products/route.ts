import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  try {
    const supabase = getServiceClient()
    const { data, error } = await supabase
      .from('products')
      .select('*, category:categories(*), variants:product_variants(*)')
      .eq('active', true)
      .order('sort_order', { ascending: true, nullsFirst: true })
      .order('name')

    if (error) {
      console.error('[GET /api/products]', error.message)
      return NextResponse.json([], { status: 200 })
    }

    const sorted = (data ?? []).sort((a, b) => {
      const oa = Number(a.sort_order ?? 0)
      const ob = Number(b.sort_order ?? 0)
      return oa !== ob ? oa - ob : String(a.name).localeCompare(String(b.name))
    })

    return NextResponse.json(sorted, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    console.error('[GET /api/products] excepción:', e)
    return NextResponse.json([], { status: 200 })
  }
}

export async function PUT(request: NextRequest) {
  try {
    const supabase = getServiceClient()
    const body = await request.json()
    const order: { id: string; sort_order: number }[] = body?.order

    if (!Array.isArray(order) || order.length === 0) {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    }

    for (const { id, sort_order } of order) {
      const { error } = await supabase
        .from('products')
        .update({ sort_order })
        .eq('id', id)
      if (error) {
        console.error('[PUT /api/products] error en producto', id, error.message)
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }

    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('[PUT /api/products] excepción:', e)
    return NextResponse.json({ error: String(e) }, { status: 500 })
  }
}
