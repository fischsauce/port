const postcss_preset_env = require("postcss-preset-env");

module.exports = {
  plugins: [
    require('postcss-import'),
    require('tailwindcss'),
    require('autoprefixer'),
    postcss_preset_env({
        browsers: 'last 2 versions',
        stage: 0,
        features: {
            'focus-within-pseudo-class': false
        }
    }),
    require('cssnano')
  ]
}
