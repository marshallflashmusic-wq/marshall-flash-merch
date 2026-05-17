import type { PackItem } from '@/types'
import { Package2 } from 'lucide-react'

interface Props {
  items: PackItem[]
}

export default function PackCollage({ items }: Props) {
  const images = items
    .filter(i => i.product?.image_url)
    .map(i => i.product!.image_url!)

  const extra = images.length - 1

  if (images.length === 0) {
    return (
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center">
        <Package2 size={28} className="text-zinc-500" />
      </div>
    )
  }

  return (
    <div className="absolute inset-0">
      <img
        src={images[0]}
        alt=""
        className="w-full h-full object-cover"
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
      {extra > 0 && (
        <div className="absolute bottom-1.5 right-1.5 bg-black/70 backdrop-blur-sm rounded-md px-1.5 py-0.5">
          <span className="text-white text-[10px] font-bold">+{extra}</span>
        </div>
      )}
    </div>
  )
}
