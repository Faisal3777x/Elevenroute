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
export const LANGUAGES: Language[] = ['en', 'es', 'ar'];

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
      es: {
        simple: 'Sí, mañana a las 3pm está bien.',
        complex: 'Necesito cambiar mi cita porque trabajo hasta tarde entre semana, y mi hija también necesita una revisión. ¿Podemos reservar las dos juntas? ¿Qué doctor está disponible?',
        replySimple: 'Listo, su cita está reservada para mañana a las 3:00 pm. Recibirá un recordatorio una hora antes.',
        replyComplex: 'Puedo ayudarle con ambas. La Dra. Patel tiene dos citas seguidas el jueves desde las 5:30 pm, así que pueden venir juntas. ¿Quiere que las reserve mientras confirma?',
      },
      ar: {
        simple: 'نعم، غداً الساعة الثالثة مناسب.',
        complex: 'أحتاج إلى تغيير موعدي لأنني أعمل حتى وقت متأخر خلال الأسبوع، وابنتي أيضاً تحتاج إلى فحص. هل يمكننا حجز الموعدين معاً؟ أي طبيب متاح؟',
        replySimple: 'تم الحجز لك غداً الساعة الثالثة مساءً. ستصلك رسالة تذكير قبل الموعد بساعة.',
        replyComplex: 'يمكنني المساعدة في الموعدين. لدى الدكتورة باتيل موعدان متتاليان يوم الخميس من الساعة الخامسة والنصف مساءً، لذا يمكنكما الحضور معاً. هل تريد أن أحجزهما لك؟',
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
      es: {
        simple: 'Mi número de pedido es 48213.',
        complex: 'Me cobraron dos veces el mismo pedido y el segundo cargo todavía no se ha devuelto. Quiero un reembolso del cobro duplicado hoy. ¿Quién lo aprueba?',
        replySimple: 'Gracias, encontré el pedido 48213. ¿Qué desea hacer con él?',
        replyComplex: 'Lamento el cobro doble. Veo ambos pagos en el pedido 48213 y ya abrí el reembolso del duplicado. Volverá a su tarjeta en 3 a 5 días hábiles y recibirá un correo de confirmación.',
      },
      ar: {
        simple: 'رقم طلبي هو 48213.',
        complex: 'تم خصم المبلغ مرتين لنفس الطلب ولم يتم إرجاع الخصم الثاني حتى الآن. أريد استرداد المبلغ المكرر اليوم. من يوافق على ذلك؟',
        replySimple: 'شكراً، وجدت الطلب 48213. ماذا تريد أن تفعل به؟',
        replyComplex: 'أعتذر عن الخصم المكرر. أرى الدفعتين على الطلب 48213 وقد فتحت طلب استرداد للمبلغ المكرر. سيعود المبلغ إلى بطاقتك خلال 3 إلى 5 أيام عمل، وستصلك رسالة تأكيد قريباً.',
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
      es: {
        simple: '¿Dónde está el pedido 55120?',
        complex: 'Mi paquete debía llegar el lunes, la página de seguimiento no se actualiza desde hace cuatro días y viajo el viernes. ¿Pueden revisar dónde está? ¿Se puede enviar a mi oficina?',
        replySimple: 'El pedido 55120 está en reparto y debería llegar hoy antes de las 6 pm.',
        replyComplex: 'Su paquete está en nuestro centro regional; una falla del escáner detuvo las actualizaciones. Lo redirigí a su oficina con entrega prioritaria, así que llegará el jueves, antes de su viaje.',
      },
      ar: {
        simple: 'أين الطلب 55120؟',
        complex: 'كان من المفترض أن يصل طردي يوم الاثنين، وصفحة التتبع لم تتحدث منذ أربعة أيام، وأنا مسافر يوم الجمعة. هل يمكنك التحقق من مكانه؟ هل يمكن تحويله إلى مكتبي؟',
        replySimple: 'الطلب 55120 خرج للتوصيل ومن المتوقع وصوله قبل الساعة السادسة مساءً اليوم.',
        replyComplex: 'طردك موجود في مركزنا الإقليمي، وقد أوقف عطل في الماسح تحديثات التتبع. حوّلته إلى عنوان مكتبك مع توصيل ذي أولوية، وسيصل يوم الخميس قبل سفرك.',
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
      es: {
        simple: 'Sí, renuévela, gracias.',
        complex: 'Mi póliza se renueva el próximo mes, pero compré un coche nuevo y me mudé a otra ciudad. ¿Cambiará mi prima? ¿Puedo añadir a mi pareja como segunda conductora al mismo tiempo?',
        replySimple: 'Listo, su póliza quedó renovada por 12 meses más con la misma prima.',
        replyComplex: 'Puedo actualizar todo a la vez. Con el coche nuevo y la nueva ciudad su prima pasa de 84 a 91 dólares al mes, y añadir a su pareja como conductora suma 12 dólares. ¿Aplico estos cambios con la renovación?',
      },
      ar: {
        simple: 'نعم، جدّدها، شكراً.',
        complex: 'تتجدد وثيقتي الشهر القادم، لكنني اشتريت سيارة جديدة وانتقلت إلى مدينة أخرى. هل سيتغير القسط؟ هل يمكنني إضافة شريكي كسائق ثانٍ في نفس الوقت؟',
        replySimple: 'تم تجديد وثيقتك لمدة 12 شهراً أخرى بنفس القسط.',
        replyComplex: 'يمكنني تحديث كل ذلك مرة واحدة. مع السيارة الجديدة والمدينة الجديدة يرتفع القسط من 84 إلى 91 دولاراً شهرياً، وإضافة شريكك كسائق تضيف 12 دولاراً. هل أطبق هذه التغييرات مع التجديد؟',
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
      es: {
        simple: 'Vale, gracias.',
        complex: 'Es la tercera vez que su técnico no llega en el horario acordado y nadie me llamó. Perdí un día de trabajo para nada. Esto es inaceptable y quiero poner una queja formal.',
        replySimple: 'De nada. ¿Hay algo más en lo que pueda ayudarle?',
        replyComplex: 'Lo siento mucho: faltar tres veces sin avisar no es aceptable. Registré una queja formal (referencia C-2291), añadí un crédito de 50 dólares por el día perdido y reservé un horario garantizado de 8 a 10 am con un técnico sénior. Un supervisor le llamará en 24 horas.',
      },
      ar: {
        simple: 'حسناً، شكراً.',
        complex: 'هذه ثالث مرة يتأخر فيها الفني عن الموعد ولم يتصل بي أحد. أخذت إجازة من العمل بلا فائدة. هذا غير مقبول وأريد تقديم شكوى رسمية.',
        replySimple: 'على الرحب والسعة. هل هناك شيء آخر يمكنني مساعدتك به؟',
        replyComplex: 'أعتذر بشدة، فتفويت ثلاث زيارات دون اتصال أمر غير مقبول. سجلت شكوى رسمية (المرجع C-2291)، وأضفت رصيداً بقيمة 50 دولاراً عن يومك الضائع، وحجزت موعداً مضموناً من 8 إلى 10 صباحاً مع فني أول. سيتصل بك مشرف خلال 24 ساعة.',
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
      es: {
        simple: '¿A qué hora abren?',
        complex: 'Estoy comparando sus planes premium y básico para un pequeño negocio con tres sucursales. ¿Cuál es la diferencia en horario de soporte? ¿Ambos incluyen el panel de análisis y la exportación de datos?',
        replySimple: 'Abrimos de 8 am a 8 pm, de lunes a sábado.',
        replyComplex: 'Premium incluye soporte 24/7; Básico cubre de 9 am a 6 pm entre semana. Ambos incluyen el panel de análisis, pero la exportación de datos es solo de Premium. Con tres sucursales, Premium también le da una vista de administración conjunta.',
      },
      ar: {
        simple: 'متى تفتحون؟',
        complex: 'أقارن بين خطتكم المميزة والأساسية لشركة صغيرة لديها ثلاثة فروع. ما الفرق في ساعات الدعم؟ هل تشمل الخطتان لوحة التحليلات وتصدير البيانات؟',
        replySimple: 'نفتح من الثامنة صباحاً حتى الثامنة مساءً، من الاثنين إلى السبت.',
        replyComplex: 'الخطة المميزة تشمل دعماً على مدار الساعة، والأساسية تغطي من 9 صباحاً إلى 6 مساءً في أيام العمل. كلتاهما تشملان لوحة التحليلات، لكن تصدير البيانات متاح في المميزة فقط، كما تمنحك عرضاً إدارياً موحداً لفروعك الثلاثة.',
      },
    },
  },
};

/** Short follow-up turns used by synthetic traffic. */
export const FOLLOW_UPS: Record<Language, string[]> = {
  en: ['Yes, that works.', 'Okay, thanks!', "It's 48213.", '3pm is fine.'],
  es: ['Sí, gracias.', 'Vale, perfecto.', 'Es el 48213.', 'Mañana a las 3pm.'],
  ar: ['نعم، شكراً.', 'تمام.', 'الرقم 48213.', 'غداً الساعة الثالثة.'],
};

const GENERIC: Record<Language, string> = {
  en: "Great — that's all set. Anything else I can help with?",
  es: 'Perfecto, ya está listo. ¿Algo más en lo que pueda ayudarle?',
  ar: 'ممتاز، تم كل شيء. هل هناك شيء آخر يمكنني مساعدتك به؟',
};

export const APOLOGY: Record<Language, string> = {
  en: "Sorry, I'm having trouble right now. Let me connect you to a member of our team.",
  es: 'Lo siento, tengo problemas en este momento. Le paso con una persona de nuestro equipo.',
  ar: 'عذراً، أواجه مشكلة الآن. سأحولك إلى أحد أعضاء فريقنا.',
};

export const LANGUAGE_NAMES: Record<Language, string> = { en: 'English', es: 'Spanish', ar: 'Arabic' };

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
