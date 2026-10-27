FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && npm cache clean --force
COPY server/ ./server/
COPY scripts/serve-reminders.mjs ./scripts/serve-reminders.mjs
COPY invitations.mjs reminders.mjs notification-status.mjs roster-version.mjs schedule-version.mjs schedule-history.mjs ./
COPY field-data.mjs profile-access.mjs ./
COPY automatic-scoring.mjs game-rules.mjs play-rules.mjs pitch-rules.mjs runner-rules.mjs league-rules.mjs base-occupancy.mjs score-history.mjs score-state.mjs score-replay.mjs ./
USER node
EXPOSE 8080
CMD ["node", "scripts/serve-reminders.mjs"]
