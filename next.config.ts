import type { NextConfig } from "next";
import { withWorkflow } from 'workflow/next';

const nextConfig: NextConfig = {
  agentRules: false,
  serverExternalPackages: ['@resvg/resvg-js'],
  outputFileTracingIncludes: {
    '/api/**': ['./assets/fonts/NotoSansSC-Regular.otf'],
    '/.well-known/workflow/**': ['./assets/fonts/NotoSansSC-Regular.otf'],
  },
};

export default withWorkflow(nextConfig);
