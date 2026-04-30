import { getProcessStats, getSystemStats } from '../src/utils/systemStats.js';

describe('systemStats utils', () => {
  test('getSystemStats returns expected shape', () => {
    const stats = getSystemStats();

    expect(stats.totalMemory).toBeGreaterThan(0);
    expect(stats.freeMemory).toBeGreaterThan(0);
    expect(stats.loadAvg).toHaveLength(3);
    expect(stats.uptime).toBeGreaterThan(0);
  });

  test('getProcessStats returns process details for existing pid', async () => {
    const stats = await getProcessStats([process.pid]);

    expect(stats[process.pid]).toEqual(
      expect.objectContaining({
        cpu: expect.any(Number),
        memory: expect.any(Number)
      })
    );
    expect(stats[process.pid].memory).toBeGreaterThan(0);
  });

  test('getProcessStats returns empty object for empty input', async () => {
    await expect(getProcessStats([])).resolves.toEqual({});
  });
});
