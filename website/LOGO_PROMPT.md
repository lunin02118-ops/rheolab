# Промт для создания логотипа RheoLab Enterprise

## Для AI-генераторов изображений (Midjourney, DALL-E, Ideogram, Leonardo AI)

---

### Основной промт (английский)

```
Create a modern, minimalist logo for "RheoLab" — a professional rheology data analysis software for the oil & gas industry.

**Concept:**
The logo should visually combine the concepts of:
1. FLOW / VISCOSITY — the science of how liquids move and deform
2. DATA ANALYSIS — charts, curves, precision measurements  
3. LABORATORY — scientific credibility and professionalism

**Visual Style:**
- Clean, geometric, contemporary tech aesthetic
- Suitable for dark backgrounds (primary use case)
- Must work as a small favicon (32x32px) and large hero image
- No gradients in the core mark (gradients allowed in full lockup)

**Color Palette (exact values):**
- Primary: Teal/Cyan (#14b8a6 to #0ea5e9 gradient acceptable)
- Background: Deep Navy (#0f172a)
- Accent: White (#f8fafc)

**Icon Concepts to Explore:**
Option A: Stylized "R" formed by a flowing viscosity curve
Option B: Abstract droplet transforming into a data chart line
Option C: Circular mark with a sinusoidal wave (representing shear stress curves)
Option D: Geometric molecule/hexagon with integrated chart elements

**Typography (if including wordmark):**
- Font style: Modern geometric sans-serif (similar to Inter, Outfit, or Geist)
- "Rheo" in bold, "Lab" in regular weight
- Optional: "Enterprise" as a subtle tagline below

**Restrictions:**
- No realistic liquids or water splashes
- No test tubes or beakers (too generic)
- No overly complex illustrations
- Must be recognizable at 16x16px

**Output Formats Needed:**
1. Icon only (square, for favicon and app icon)
2. Horizontal lockup (icon + wordmark)
3. Monochrome white version (for dark backgrounds)
4. SVG vector format

**Mood/Feel:**
Professional, Trustworthy, Innovative, Premium B2B SaaS
Reference brands: Linear, Vercel, Stripe, Notion
```

---

### Короткий промт для Midjourney

```
minimalist tech logo, letter R formed by flowing curve, teal cyan gradient #14b8a6 to #0ea5e9, dark navy background #0f172a, rheology data analysis software, geometric clean design, vector style, professional B2B SaaS aesthetic --v 6 --ar 1:1
```

---

### Промт для DALL-E 3

```
A minimalist, professional logo design for a software company called "RheoLab". The logo should feature a stylized letter "R" that incorporates a flowing curve representing viscosity and fluid dynamics. Use a teal-to-cyan gradient (#14b8a6 to #0ea5e9) on a deep navy background (#0f172a). The design should be clean, geometric, and suitable for both large displays and small favicons. Style: modern tech company, similar to Linear, Vercel, or Stripe branding. Vector art, high contrast, no shadows.
```

---

### Промт для Ideogram

```
Logo design: "RheoLab" - professional rheology software. Minimalist geometric mark combining letter R with flowing data curve. Teal/cyan accent on dark navy. Clean vector style. B2B SaaS aesthetic. No text in logo mark.
```

---

## Технические требования

### Необходимые форматы файлов:

| Файл | Размер | Использование |
|------|--------|---------------|
| `favicon.svg` | 32x32 | Иконка вкладки браузера |
| `favicon.ico` | 16x16, 32x32, 48x48 | Совместимость со старыми браузерами |
| `apple-touch-icon.png` | 180x180 | iOS закладки |
| `logo-icon.svg` | 512x512 | Иконка приложения |
| `logo-full.svg` | 200x50 | Горизонтальный логотип с текстом |
| `og-image.jpg` | 1200x630 | Превью в соцсетях |

### Цветовая палитра бренда:

```css
:root {
  /* Primary Accent - Teal/Cyan */
  --brand-primary: #14b8a6;
  --brand-primary-light: #2dd4bf;
  --brand-primary-dark: #0d9488;
  
  /* Secondary - Blue */
  --brand-secondary: #0ea5e9;
  --brand-secondary-light: #38bdf8;
  --brand-secondary-dark: #0284c7;
  
  /* Backgrounds */
  --brand-bg-dark: #0f172a;
  --brand-bg-dark-secondary: #1e293b;
  
  /* Text */
  --brand-text-primary: #f8fafc;
  --brand-text-secondary: #94a3b8;
  
  /* CTA - Amber */
  --brand-cta: #f59e0b;
}
```

---

## Концепции логотипа (описание)

### Концепция A: Буква "R" из потоковой кривой
Стилизованная буква R, где вертикальная линия — это ось Y графика, а изогнутая часть — реологическая кривая (shear stress vs shear rate). Ножка R представляет собой линию тренда данных.

### Концепция B: Капля → График
Абстрактная форма, начинающаяся как капля жидкости вверху и трансформирующаяся в линию графика внизу. Символизирует переход от физического образца к цифровым данным.

### Концепция C: Круг с волной
Круглая эмблема с синусоидальной волной внутри, напоминающей осциллограмму или кривую вязкости. Универсальный знак, легко масштабируется.

### Концепция D: Гексагон с элементами данных
Шестиугольник (ассоциация с молекулами, химией) с интегрированными точками данных или мини-графиком внутри.

---

## Текущий SVG-код favicon (для обновления)

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="logoGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#14b8a6"/>
      <stop offset="100%" style="stop-color:#0ea5e9"/>
    </linearGradient>
  </defs>
  <!-- Rounded square background -->
  <rect width="32" height="32" rx="7" fill="url(#logoGrad)"/>
  <!-- Stylized "R" formed by flowing viscosity curve -->
  <g fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <!-- Main vertical stroke of R -->
    <path d="M10 8 L10 24"/>
    <!-- Curved top of R (representing flow curve) -->
    <path d="M10 8 C10 8 18 6 20 11 C22 16 14 17 10 16"/>
    <!-- Diagonal leg of R (representing data trend) -->
    <path d="M14 16 L22 24"/>
  </g>
  <!-- Small data points representing measurements -->
  <circle cx="22" cy="10" r="1.5" fill="white" opacity="0.8"/>
  <circle cx="20" cy="20" r="1" fill="white" opacity="0.6"/>
</svg>
```

---

*Документ создан: Январь 2026*
*Версия: 1.0*
