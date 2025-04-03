/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (config) => {
    // Add fallbacks for Node.js core modules
    config.resolve.fallback = {
      ...config.resolve.fallback,
      buffer: require.resolve('buffer/'),
    };

    config.plugins.push(
      new config.webpack.ProvidePlugin({
        Buffer: ['buffer', 'Buffer'],
      })
    );

    return config;
  },
};

export default nextConfig;
