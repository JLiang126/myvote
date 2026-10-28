const mockJson_dynamicResults = jest.fn((body: unknown, init?: unknown) => ({ body, init }));
const mockSelect_dynamicResults = jest.fn();
const mockIsAdmin_dynamicResults = jest.fn();

jest.mock('next/server', () => ({
    NextResponse: {
        json: (...args: [unknown, unknown?]) => mockJson_dynamicResults(...args),
    },
}));

jest.mock('@/auth', () => ({
    auth: async () => ({ user: { id: 'admin-1' }, accessToken: 'token' }),
}));

jest.mock('@/utils/is-admin', () => ({
    isAdmin: (...args: unknown[]) => mockIsAdmin_dynamicResults(...args),
}));

jest.mock('@/db/index', () => ({
    db: {
        select: (...args: unknown[]) => mockSelect_dynamicResults(...args),
    },
}));

const candidates = [
    { id: 'candidate-1', name: 'Candidate One', election: 'election-1' },
    { id: 'candidate-2', name: 'Candidate Two', election: 'election-1' },
];
const links = [
    { candidate_id: 'candidate-1', position_id: 'position-1' },
    { candidate_id: 'candidate-2', position_id: 'position-2' },
];
const positions = [
    { id: 'position-1', name: 'President', election: 'election-1', vacancies: 1 },
    { id: 'position-2', name: 'Secretary', election: 'election-1', vacancies: 1 },
];

function configureSelectMocks() {
    mockSelect_dynamicResults.mockImplementation(() => {
        let queryIndex = 0;
        const index = mockSelect_dynamicResults.mock.calls.length - 1;
        queryIndex = index % 4;
        return {
            from: () => {
                if (queryIndex === 0) {
                    return { innerJoin: () => ({ where: async () => [] }) };
                }
                if (queryIndex === 1) {
                    return { where: async () => candidates };
                }
                if (queryIndex === 2) {
                    return Promise.resolve(links);
                }
                return { where: async () => positions };
            },
        };
    });
}

describe('dynamic results route', () => {
    beforeEach(() => {
        jest.resetModules();
        mockJson_dynamicResults.mockClear();
        mockSelect_dynamicResults.mockReset();
        mockIsAdmin_dynamicResults.mockReset().mockReturnValue(true);
        configureSelectMocks();
    });

    test('includes positions even when no ballots have been submitted', async () => {
        const { GET } = await import('../[id]/route');
        const response = await GET({
            url: 'http://localhost/api/results/election-1',
        } as never);

        expect(response).toEqual({
            body: {
                results: expect.arrayContaining([
                    expect.objectContaining({
                        position_id: 'position-1',
                        winners: [expect.objectContaining({ id: 'candidate-1' })],
                    }),
                    expect.objectContaining({
                        position_id: 'position-2',
                        winners: [expect.objectContaining({ id: 'candidate-2' })],
                    }),
                ]),
            },
            init: { status: 200 },
        });
    });

    test('keeps a manually selected winner despite stale exclusion data', async () => {
        const { POST } = await import('../[id]/route');
        const response = await POST({
            url: 'http://localhost/api/results/election-1',
            json: async () => ({
                exclusions: { 'position-1': ['candidate-1'], 'position-2': ['candidate-1'] },
                manualOverrides: { 'position-1': ['candidate-1'] },
            }),
        } as never);

        expect(response).toEqual({
            body: {
                results: expect.arrayContaining([
                    expect.objectContaining({
                        position_id: 'position-1',
                        winners: [expect.objectContaining({ id: 'candidate-1' })],
                    }),
                ]),
            },
            init: { status: 200 },
        });
    });

    test('requires an administrator to adjust results', async () => {
        mockIsAdmin_dynamicResults.mockReturnValue(false);
        const { POST } = await import('../[id]/route');
        await POST({
            url: 'http://localhost/api/results/election-1',
            json: async () => ({}),
        } as never);

        expect(mockJson_dynamicResults).toHaveBeenCalledWith(
            { error: 'Admin privileges required.' },
            { status: 403 }
        );
    });
});
