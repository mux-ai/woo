import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

process.env.PAYMENT_API_KEY = 'test-key'

type PaymentModule = typeof import('../demo/paymentService')

let payment: PaymentModule

beforeAll(async () => {
  payment = await import('../demo/paymentService')
})

const jsonResponse = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('register', () => {
  it('registers a customer and returns the registration', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { registrationId: 'reg_1', customerId: 'cus_1' })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      payment.register({ customerId: ' cus_1 ', email: 'dev@example.com' })
    ).resolves.toEqual({ registrationId: 'reg_1', customerId: 'cus_1' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/payments/register')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')
    expect(JSON.parse(init.body as string)).toEqual({
      customerId: 'cus_1',
      email: 'dev@example.com'
    })
  })

  it('rejects invalid input without calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(
      payment.register({ customerId: '', email: 'dev@example.com' })
    ).rejects.toThrow('customerId is required')
    await expect(
      payment.register({ customerId: 'cus_1', email: 'not-an-email' })
    ).rejects.toThrow('a valid email is required')

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps a 409 response to a duplicate-registration error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409)))

    await expect(
      payment.register({ customerId: 'cus_1', email: 'dev@example.com' })
    ).rejects.toThrow('customer cus_1 is already registered')
  })

  it('throws a generic error on other failures', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500)))

    await expect(
      payment.register({ customerId: 'cus_1', email: 'dev@example.com' })
    ).rejects.toThrow('registration for customer cus_1 failed')
  })
})
