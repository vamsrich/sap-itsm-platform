/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      // Denser type scale tuned for enterprise UX (closer to ServiceNow / Salesforce
      // density). All sizes shifted ~12% smaller than Tailwind defaults; spacing
      // utilities are unchanged.
      fontSize: {
        xs:    ['0.6875rem', { lineHeight: '1rem' }],     // 11px (was 12)
        sm:    ['0.8125rem', { lineHeight: '1.25rem' }],  // 13px (was 14)
        base:  ['0.875rem',  { lineHeight: '1.375rem' }], // 14px (was 16)
        lg:    ['1rem',      { lineHeight: '1.5rem' }],   // 16px (was 18)
        xl:    ['1.125rem',  { lineHeight: '1.625rem' }], // 18px (was 20)
        '2xl': ['1.375rem',  { lineHeight: '1.875rem' }], // 22px (was 24)
        '3xl': ['1.625rem',  { lineHeight: '2rem' }],     // 26px (was 30)
        '4xl': ['2rem',      { lineHeight: '2.25rem' }],  // 32px (was 36)
      },
      animation: {
        'fadeIn': 'fadeIn 0.15s ease-out',
      },
    },
  },
  plugins: [],
};
