// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'

process.env.PAYMENT_API_KEY = 'test-key'

type HooksModule = typeof import('../demo/paymentHooks')

let hooks: HooksModule

beforeAll(async () => {
  hooks = await import('../demo/paymentHooks')
})

const jsonResponse = (status: number, body: unknown = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })

const createClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false }
    }
  })

const createWrapper = (queryClient: QueryClient) =>
  ({ children }: { children: ReactNode }) =>
    createElement(QueryClientProvider, { client: queryClient }, children)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('usePayment', () => {
  it('fetches a payment by id', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { paymentId: 'pay_1', status: 'settled' })
    )
    vi.stubGlobal('fetch', fetchMock)

    const queryClient = createClient()
    const { result } = renderHook(() => hooks.usePayment('pay_1'), {
      wrapper: createWrapper(queryClient)
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ paymentId: 'pay_1', status: 'settled' })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.example.com/payments/pay_1')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-key')

    expect(queryClient.getQueryData(hooks.paymentKeys.detail('pay_1'))).toEqual({
      paymentId: 'pay_1',
      status: 'settled'
    })
  })

  it('stays disabled without a payment id', () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => hooks.usePayment(undefined), {
      wrapper: createWrapper(createClient())
    })

    expect(result.current.fetchStatus).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('surfaces fetch errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(500)))

    const { result } = renderHook(() => hooks.usePayment('pay_1'), {
      wrapper: createWrapper(createClient())
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('payment pay_1 failed')
  })
})

describe('useRegisterPayment', () => {
  it('registers a customer and invalidates payment queries', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { registrationId: 'reg_1', customerId: 'cus_1' })
    )
    vi.stubGlobal('fetch', fetchMock)

    const queryClient = createClient()
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    const { result } = renderHook(() => hooks.useRegisterPayment(), {
      wrapper: createWrapper(queryClient)
    })

    result.current.mutate({ customerId: 'cus_1', email: 'dev@example.com' })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ registrationId: 'reg_1', customerId: 'cus_1' })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: hooks.paymentKeys.all })
  })

  it('exposes validation errors without calling the API', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => hooks.useRegisterPayment(), {
      wrapper: createWrapper(createClient())
    })

    result.current.mutate({ customerId: '', email: 'dev@example.com' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error?.message).toBe('customerId is required')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
