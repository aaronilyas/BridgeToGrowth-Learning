// Local physical-device builds opt in; ordinary/production Expo config is unchanged.
module.exports = ({ config }) => {
  if (process.env.BTG_IPHONE_DEV !== '1') return config;
  return {
    ...config,
    ios: {
      ...config.ios,
      ...(process.env.BTG_APPLE_TEAM_ID
        ? { appleTeamId: process.env.BTG_APPLE_TEAM_ID }
        : {}),
      infoPlist: {
        ...config.ios?.infoPlist,
        NSLocalNetworkUsageDescription:
          'Connect to the local BridgeToGrowth development server on your Mac.',
      },
    },
  };
};
