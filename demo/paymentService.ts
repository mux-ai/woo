// Demo file — open it in Woo Studio to see rule diagnostics.

const apiKey = process.env.PAYMENT_API_KEY
if (!apiKey) {
  throw new Error("PAYMENT_API_KEY environment variable is not set")
}

const config = {
  apiKey,
  retries: 3
}

export interface RegisterPaymentInput {
  customerId: string
  email: string
}

export interface Registration {
  registrationId: string
  customerId: string
}

export async function register(input: RegisterPaymentInput): Promise<Registration> {
  if (!input.customerId?.trim()) {
    throw new Error("customerId is required")
  }
  if (!input.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)) {
    throw new Error("a valid email is required")
  }

  const response = await fetch("https://api.example.com/payments/register", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ customerId: input.customerId.trim(), email: input.email })
  })

  if (response.status === 409) {
    throw new Error(`customer ${input.customerId} is already registered`)
  }
  if (!response.ok) {
    throw new Error(`registration for customer ${input.customerId} failed`)
  }

  return (await response.json()) as Registration
}

export interface Payment {
  paymentId: string
  status: string
}

export async function fetchPayment(paymentId: string): Promise<Payment> {
  const response = await fetch(`https://api.example.com/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${config.apiKey}` }
  })
  if (!response.ok) {
    throw new Error(`payment ${paymentId} failed`)
  }
  return (await response.json()) as Payment
}
