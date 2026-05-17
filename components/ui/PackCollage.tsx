import type { PackItem } from '@/types'
import { Package2 } from 'lucide-react'

interface Props {
  items: PackItem[]
}

export default function PackCollage({ items }: Props) {
  const images = items
    .filter(i => i.product?.image_url)
    .slice(0, 4)
    .map(i => i.product!.image_url!)

  if (images.length === 0) {
    return (
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-700 to-zinc-900 flex items-center justify-center">
        <Package2 size={28} className="text-zinc-500" />
      </div>
    )
  }

  if (images.length === 1) {
    return (
      <img
        src={images[0]}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
        onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
      />
    )
  }

  if (images.length === 2) {
    return (
      <div className="absolute inset-0 grid grid-cols-2 gap-px bg-zinc-800">
        {images.map((url, i) => (
          <img
            key={i}
            src={url}
            alt=""
            className="w-full h-full object-cover"
            onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
          />
        ))}
      </div>
    )
  }

  return (
    <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-px bg-zinc-800">
      {images.map((url, i) => (
        <img
          key={i}
          src={url}
          alt=""
          className="w-full h-full object-cover"
          onError={e => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      ))}
    </div>
  )
}
