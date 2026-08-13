import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  fetchPayment,
  register,
  type RegisterPaymentInput,
  type Registration
} from './paymentService'

export const paymentKeys = {
  all: ['payments'] as const,
  detail: (paymentId: string) => ['payments', paymentId] as const
}

export function usePayment(paymentId: string | undefined) {
  return useQuery({
    queryKey: paymentKeys.detail(paymentId ?? ''),
    queryFn: () => fetchPayment(paymentId as string),
    enabled: Boolean(paymentId),
    staleTime: 30_000
  })
}

export function useRegisterPayment() {
  const queryClient = useQueryClient()
  return useMutation<Registration, Error, RegisterPaymentInput>({
    mutationFn: register,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: paymentKeys.all })
  })
}
