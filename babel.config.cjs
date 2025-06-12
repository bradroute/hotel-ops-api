module.exports = {
  presets: [
    [
      "@babel/preset-env",
      {
        // compile to the currently-installed Node version
        targets: { node: "current" }
      }
    ]
  ]
};
