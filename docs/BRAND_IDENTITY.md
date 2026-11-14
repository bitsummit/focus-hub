# Focus. — Identidad visual oficial

Esta es la única referencia vigente de identidad visual de Focus.

## Identidad

**Focus.**, siempre con el punto final verde en el logotipo. El lema oficial es
**Quiet the noise. Find clarity.** y permanece en inglés en ambas interfaces.
Se presenta una sola vez en el login, inmediatamente debajo de la marca.
Claridad, calma, organización y simplicidad: reducir el ruido mental sin añadir
ornamentos ni mensajes motivacionales nuevos.

La aplicación es Focus.; el dashboard es **Mi espacio / My space**. Las rutas,
el repositorio y paquete `focus-hub`, las cookies, las claves de preferencias,
los nombres de bases de datos y las variables de entorno son identificadores
técnicos estables. Este cambio no autoriza migrarlos ni modificar datos.

## Una única construcción

- Componente: [`BrandLogo`](../src/components/BrandLogo.tsx).
- Nombre y lema: [`src/brand.ts`](../src/brand.ts).
- Tokens, tipografía y composición: [`src/brand.css`](../src/brand.css).
- Símbolo compartido, incluido el favicon: [`public/brand-symbol.svg`](../public/brand-symbol.svg).
- Fuente oficial local: [`public/fonts/manrope-variable.woff2`](../public/fonts/manrope-variable.woff2).
  [Procedencia, hashes y licencia](../public/fonts/README.md).

La palabra utiliza **Manrope ExtraBold, peso 800**, sin cursiva ni síntesis de
peso. Letras `#293B39`, punto `#39796A`. En oscuro las letras son `#EDF4F1`;
el punto y el fondo del símbolo mantienen `#39796A`, y la hoja permanece blanca.

El símbolo conserva exactamente las dos curvas de `Leaf` de Lucide 0.468.0,
con trazo 2 y extremos/uniones redondeados en un viewBox de 24. El cuadrado mide
35 × 35, radio 10; la hoja ocupa 21 × 21 y se coloca en (7, 7). No redibujar,
sustituir ni estirar. [Licencia del símbolo](../public/brand-symbol.LICENSE.txt).

| Variante | Escala | Símbolo | Texto | Espacio símbolo/texto | Tracking |
|---|---:|---:|---:|---:|---:|
| `compact` | 1 | 35 px | 23 px | 10 px | −0,9 px |
| `default` | 1,2 | 42 px | 27,6 px | 12 px | −1,08 px |
| `large` | 1,6 | 56 px | 36,8 px | 16 px | −1,44 px |

El punto va unido al nombre, sin separación adicional. Las medidas relativas
proceden del logotipo original de la barra lateral, no de una aproximación.
`large` se usa en login; `compact` en barra lateral y pie. La cabecera móvil y
la carga inicial usan el símbolo con `iconOnly`. En la barra lateral plegada
se oculta la palabra, conservando el mismo recurso. No se escala cada elemento
por separado. Área libre recomendada alrededor del conjunto: al menos la mitad
del lado del símbolo de su variante; no cuenta el espacio interno ya definido.

Uso correcto:

```tsx
<BrandLogo size="large" />
<BrandLogo size="compact" />
<BrandLogo size="compact" iconOnly />
```

Incorrecto: escribir otra palabra con una fuente parecida, recrear la hoja,
quitar el punto en un wordmark, cambiar el verde según la sección, introducir
márgenes propios en la palabra o añadir una variante directamente en una página.
El símbolo solo, sin palabra ni punto, sí es válido como icono/favicon.

## Sistema visual implementado

| Token | Claro | Oscuro |
|---|---|---|
| `--brand-green` | `#39796A` | `#39796A` |
| `--brand-word-light` | `#293B39` | — |
| `--brand-word-dark` | — | `#EDF4F1` |
| `--brand-word-color` | alias de word-light | alias de word-dark |
| `--brand-story-bg` | `#EEF3E9` | `#202E29` |
| `--brand-headline-middle` | alias de brand-green | `#91B9A7` |
| `--brand-headline-end` | `#708568` | `#BDD0B8` |
| `--brand-tagline` | `#526B62` | `#B8C9C1` |
| `--brand-orbit-line` | `#D6E2CA` | `#496052` |
| `--brand-orbit-near` | `#E5EDDF` | `#2C4035` |
| `--brand-orbit-middle` | `#E8EFE3` | `#293C32` |
| `--brand-orbit-far` | `#EAF1E6` | `#26372F` |

Se aplican a oscuro explícito y a `system` cuando el navegador prefiere oscuro.
El SVG incluye los colores oficiales como recurso autónomo para favicon: al
cambiar los colores de identidad hay que mantenerlo sincronizado con los tokens.
Los metadatos iniciales de `index.html` también deben reflejar nombre, símbolo y
color vigentes; no tienen una interpretación alternativa del logotipo.

Manrope también es la fuente de encabezados existente; DM Sans conserva su uso
como tipografía de lectura/interacción y su integración actual. La fuente
Manrope variable 200–800 se distribuye localmente bajo OFL, sin cambiar trazos,
ejes o nombres, para evitar sustituciones del logotipo por problemas de red.

Los tokens `--ux-*` y `--status-*` siguen gobernando los controles y los estados
funcionales. El verde de marca no reemplaza los colores semánticos de estado.
Mantener texto normal con contraste AA y texto grande legible sobre su fondo;
no depender solo del color para comunicar estados. No atenuar el wordmark con
opacidad de página. El lema usa peso normal, tamaño menor al nombre y color
secundario; nunca mayúsculas sostenidas, cursiva o efectos decorativos.

La pantalla de acceso conserva las dos columnas en escritorio y la adaptación
vertical móvil. El titular mantiene tres líneas y tres tonos: «Tareas,» /
«proyectos y» / «progreso.». Se conserva el texto de apoyo previo y el estilo
30 px/peso 700 del encabezado de acceso en escritorio, con sus ajustes responsive
existentes. Los formularios, mensajes de error, carga y autenticación conservan
su comportamiento.

## Mantenimiento

Toda modificación de identidad actualiza esta referencia y los recursos afectados
en el mismo cambio. No crear variantes por página; traducir la interfaz nunca
cambia el nombre, lema o contenido personal. Los identificadores técnicos siguen
estables. La publicación e integración siguen [AGENTS.md](../AGENTS.md).

Revisar login, barra lateral normal/plegada, cabecera móvil, pie, favicon y pestaña
en ambos idiomas y temas. Las cuatro referencias visuales vigentes están enlazadas
en [README](../README.md). La reproducción de capturas y las comprobaciones se
describen en [Operaciones](OPERATIONS.md); no acumular aquí resultados por entrega.

En desarrollo, las URLs oficiales del SVG y Manrope son las mismas que en el
compilado. Conservarlas y su lista explícita en `server/development.ts`; no abrir
el directorio público completo para facilitar recursos de marca.
