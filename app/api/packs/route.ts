import { createClient } from '@supabase/supabase-js'
import { NextRequest, NextResponse } from 'next/server'

function getServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}

export async function GET() {
  const supabase = getServiceClient()
  const { data, error } = await supabase
    .from('packs')
    .select(`
      *,
      items:pack_items(
        *,
        product:products(
          *,
          category:categories(*),
          variants:product_variants(*)
        )
      )
    `)
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ packs: data ?? [] })
}

interface PackItemBody {
  product_id: string
  quantity: number
  individual_pack_price?: number | null
}

export async function POST(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { name, description, sale_price, online_price, items } = body

  if (!name || sale_price == null) {
    return NextResponse.json({ error: 'Nombre y precio son obligatorios' }, { status: 400 })
  }

  const { data: pack, error: packError } = await supabase
    .from('packs')
    .insert({
      name,
      description: description || null,
      sale_price,
      online_price: online_price ?? null,
      active: true,
    })
    .select()
    .single()

  if (packError) return NextResponse.json({ error: packError.message }, { status: 500 })

  if (items && items.length > 0) {
    const { error: itemsError } = await supabase
      .from('pack_items')
      .insert(items.map((i: PackItemBody) => ({
        pack_id: pack.id,
        product_id: i.product_id,
        quantity: i.quantity,
        individual_pack_price: i.individual_pack_price ?? null,
      })))

    if (itemsError) {
      await supabase.from('packs').delete().eq('id', pack.id)
      return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ pack })
}

export async function PATCH(request: NextRequest) {
  const supabase = getServiceClient()
  const body = await request.json()
  const { id, name, description, sale_price, online_price, active, items } = body

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const updateData: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (name !== undefined) updateData.name = name
  if (description !== undefined) updateData.description = description || null
  if (sale_price !== undefined) updateData.sale_price = sale_price
  if (online_price !== undefined) updateData.online_price = online_price
  if (active !== undefined) updateData.active = active

  const { error: packError } = await supabase
    .from('packs')
    .update(updateData)
    .eq('id', id)

  if (packError) return NextResponse.json({ error: packError.message }, { status: 500 })

  if (items !== undefined) {
    await supabase.from('pack_items').delete().eq('pack_id', id)
    if (items.length > 0) {
      const { error: itemsError } = await supabase
        .from('pack_items')
        .insert(items.map((i: PackItemBody) => ({
          pack_id: id,
          product_id: i.product_id,
          quantity: i.quantity,
          individual_pack_price: i.individual_pack_price ?? null,
        })))
      if (itemsError) return NextResponse.json({ error: itemsError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request: NextRequest) {
  const supabase = getServiceClient()
  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')

  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await supabase.from('packs').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
