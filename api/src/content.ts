import type { Language, TestCase, TurnType, UseCase } from '../../shared/types.ts';

interface Entry {
  simple: string;
  complex: string;
  replySimple: string;
  replyComplex: string;
}

interface UseCaseContent {
  label: string;
  expectSimple: string;
  expectComplex: string;
  langs: Record<Language, Entry>;
}

export const USE_CASES: UseCase[] = ['appointment', 'refund', 'order_status', 'insurance', 'complaint', 'faq'];
export const LANGUAGES: Language[] = ['en'];

export const CONTENT: Record<UseCase, UseCaseContent> = {
  appointment: {
    label: 'Appointment booking',
    expectSimple: 'Confirms the booking for 3 pm tomorrow.',
    expectComplex: 'Offers adjacent after-work slots for both people and asks to hold them.',
    langs: {
      en: {
        simple: 'Yes, 3pm tomorrow works for me.',
        complex: 'I need to move my appointment, but I can only come after work on weekdays, and my daughter also needs a check-up. Can we book both together? Which doctor is free?',
        replySimple: "Done — you're booked for 3:00 pm tomorrow. You'll get a text reminder an hour before.",
        replyComplex: 'I can help with both. Dr. Patel has two back-to-back slots on Thursday from 5:30 pm, so you and your daughter can come together. Shall I hold them while you confirm?',
      },
    },
  },
  refund: {
    label: 'Refund',
    expectSimple: 'Finds the order and asks what the customer wants to do.',
    expectComplex: 'Apologises, opens a refund for the duplicate charge and gives a timeline.',
    langs: {
      en: {
        simple: 'My order number is 48213.',
        complex: "I was charged twice for the same order and the second charge still hasn't been reversed. I want a refund for the duplicate today. Who approves this?",
        replySimple: 'Thanks — I found order 48213. What would you like to do with it?',
        replyComplex: "I'm sorry about the double charge. I can see both payments on order 48213 and I've opened a refund for the duplicate. It will be back on your card within 3–5 business days, and you'll get a confirmation email shortly.",
      },
    },
  },
  order_status: {
    label: 'Order status',
    expectSimple: 'Gives the delivery status and ETA.',
    expectComplex: 'Explains the tracking gap and redirects the parcel to arrive before the trip.',
    langs: {
      en: {
        simple: 'Where is order 55120?',
        complex: "My package was supposed to arrive on Monday, the tracking page hasn't updated in four days, and I'm travelling on Friday. Can you check where it is? Can it be redirected to my office?",
        replySimple: 'Order 55120 is out for delivery and should arrive by 6 pm today.',
        replyComplex: "Your package is at our regional hub — a scanner fault stopped the tracking updates. I've redirected it to your office address with priority delivery, so it will arrive Thursday, before your trip.",
      },
    },
  },
  insurance: {
    label: 'Insurance renewal',
    expectSimple: 'Confirms the renewal.',
    expectComplex: 'Quotes the new premium, the cost of a second driver, and asks to apply both.',
    langs: {
      en: {
        simple: 'Yes, renew it, thanks.',
        complex: 'My policy renews next month, but I bought a new car and moved to a different city. Will my premium change? Can I add my partner as a second driver at the same time?',
        replySimple: 'Done — your policy is renewed for another 12 months at the same premium.',
        replyComplex: 'I can update all of that in one go. With the new car and city your premium goes from $84 to $91 a month, and adding your partner as a named driver adds $12. Shall I apply these changes with the renewal?',
      },
    },
  },
  complaint: {
    label: 'Complaint',
    expectSimple: 'Acknowledges and offers further help.',
    expectComplex: 'Apologises, files the complaint with a reference, offers compensation and a fixed slot.',
    langs: {
      en: {
        simple: 'Okay, thank you.',
        complex: 'This is the third time your technician missed the appointment window and nobody called me. I took a day off work for nothing. This is unacceptable and I want to file a formal complaint.',
        replySimple: "You're welcome. Is there anything else I can help with?",
        replyComplex: "I'm truly sorry — missing three visits without a call isn't acceptable. I've filed a formal complaint (reference C-2291), added a $50 credit for your lost day, and booked a guaranteed 8–10 am slot with a senior technician. A supervisor will call you within 24 hours.",
      },
    },
  },
  faq: {
    label: 'General FAQ',
    expectSimple: 'Gives opening hours.',
    expectComplex: 'Compares support hours and confirms which plan includes analytics and export.',
    langs: {
      en: {
        simple: 'What time do you open?',
        complex: "I'm comparing your premium and basic plans for a small business with three locations. What's the difference in support hours? Do both include the analytics dashboard and data export?",
        replySimple: "We're open from 8 am to 8 pm, Monday to Saturday.",
        replyComplex: 'Premium includes 24/7 support; Basic covers 9 am–6 pm on weekdays. Both include the analytics dashboard, but data export is Premium only. With three locations, Premium also gives you one admin view across all of them.',
      },
    },
  },
};

/** Short follow-up turns used by synthetic traffic. */
export const FOLLOW_UPS: Record<Language, string[]> = {
  en: ['Yes, that works.', 'Okay, thanks!', "It's 48213.", '3pm is fine.'],
};

const GENERIC: Record<Language, string> = {
  en: "Great — that's all set. Anything else I can help with?",
};

export const APOLOGY: Record<Language, string> = {
  en: "Sorry, I'm having trouble right now. Let me connect you to a member of our team.",
};

export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English' };

/** Canned demo reply for a turn. */
export function cannedReply(message: string, useCase: UseCase, language: Language, turnType: TurnType): string {
  const e = CONTENT[useCase].langs[language];
  if (message.trim() === e.simple) return e.replySimple;
  if (message.trim() === e.complex || turnType === 'complex') return e.replyComplex;
  return GENERIC[language];
}

export const TEST_CASES: TestCase[] = USE_CASES.flatMap((useCase) =>
  LANGUAGES.flatMap((language) =>
    (['simple', 'complex'] as const).map((turnType) => ({
      id: `${useCase}-${language}-${turnType}`,
      useCase,
      language,
      turnType,
      message: CONTENT[useCase].langs[language][turnType],
      expected: turnType === 'simple' ? CONTENT[useCase].expectSimple : CONTENT[useCase].expectComplex,
    })),
  ),
);
