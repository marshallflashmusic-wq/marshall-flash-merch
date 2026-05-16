/**
 * Genera iconos PNG para la PWA a partir del SVG.
 * Requiere: npm install sharp (solo para desarrollo)
 * Uso: node scripts/generate-icons.js
 */
const fs = require('fs')
const path = require('path')

const sizes = [192, 512]
const svgPath = path.join(__dirname, '../public/icons/icon.svg')
const outputDir = path.join(__dirname, '../public/icons')

async function generate() {
  try {
    const sharp = require('sharp')
    const svgContent = fs.readFileSync(svgPath)

    for (const size of sizes) {
      await sharp(svgContent)
        .resize(size, size)
        .png()
        .toFile(path.join(outputDir, `icon-${size}.png`))
      console.log(`✓ Generado icon-${size}.png`)
    }
    console.log('Iconos PWA generados correctamente.')
  } catch (err) {
    if (err.code === 'MODULE_NOT_FOUND') {
      console.log('Para generar iconos PNG, instala sharp: npm install --save-dev sharp')
      console.log('Luego ejecuta: node scripts/generate-icons.js')
      console.log('')
      console.log('Alternativa: crea manualmente los archivos:')
      console.log('  public/icons/icon-192.png (192x192 px)')
      console.log('  public/icons/icon-512.png (512x512 px)')
    } else {
      console.error(err)
    }
  }
}

generate()
