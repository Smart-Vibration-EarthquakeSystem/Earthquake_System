#define F_CPU 16000000UL

#include <avr/io.h>
#include <util/delay.h>
#include <stdint.h>

/* ===================== USER SETTINGS ===================== */
#define LCD_I2C_ADDR  0x27   // change to 0x3F if your LCD doesn't work
#define BAUD_RATE     9600
#define UBRR_VALUE    103    // for 16MHz and 9600 baud

/* PCF8574 -> LCD typical mapping:
   P0 = RS
   P1 = RW
   P2 = EN
   P3 = Backlight
   P4 = D4
   P5 = D5
   P6 = D6
   P7 = D7
*/
#define LCD_RS   0x01
#define LCD_RW   0x02
#define LCD_EN   0x04
#define LCD_BL   0x08

/* ===================== PROTOTYPES ===================== */
void ADC_Init(void);
uint16_t ADC_Read(uint8_t channel);

void TWI_Init(void);
uint8_t TWI_Start(uint8_t address_rw);
void TWI_Stop(void);
uint8_t TWI_Write(uint8_t data);

void LCD_Init(void);
void LCD_Clear(void);
void LCD_SetCursor(uint8_t row, uint8_t col);
void LCD_Print(const char *s);
void LCD_PrintU16(uint16_t v);

void UART_Init(unsigned int ubrr);
void UART_TxChar(char data);
void UART_Print(const char *str);
void UART_PrintU16(uint16_t v);
void UART_SendReading(uint16_t value, const char *status);

/* ===================== TWI (I2C) ===================== */
void TWI_Init(void)
{
    TWSR = 0x00;           // prescaler = 1
    TWBR = 72;             // ~100kHz for 16MHz
    TWCR = (1 << TWEN);    // enable TWI
}

uint8_t TWI_Start(uint8_t address_rw)
{
    TWCR = (1 << TWINT) | (1 << TWSTA) | (1 << TWEN);
    while (!(TWCR & (1 << TWINT)));

    TWDR = address_rw;
    TWCR = (1 << TWINT) | (1 << TWEN);
    while (!(TWCR & (1 << TWINT)));

    return 1;
}

void TWI_Stop(void)
{
    TWCR = (1 << TWINT) | (1 << TWEN) | (1 << TWSTO);
    _delay_us(10);
}

uint8_t TWI_Write(uint8_t data)
{
    TWDR = data;
    TWCR = (1 << TWINT) | (1 << TWEN);
    while (!(TWCR & (1 << TWINT)));
    return 1;
}

/* ===================== LCD over PCF8574 ===================== */
static uint8_t lcd_backlight = LCD_BL;

static void LCD_WritePCF(uint8_t data)
{
    TWI_Start((LCD_I2C_ADDR << 1) | 0);
    TWI_Write(data | lcd_backlight);
    TWI_Stop();
}

static void LCD_PulseEnable(uint8_t data)
{
    LCD_WritePCF(data | LCD_EN);
    _delay_us(1);
    LCD_WritePCF(data & ~LCD_EN);
    _delay_us(50);
}

static void LCD_Write4(uint8_t nibble, uint8_t control)
{
    uint8_t data = (nibble & 0xF0) | control;
    LCD_PulseEnable(data);
}

static void LCD_Send(uint8_t value, uint8_t modeRS)
{
    uint8_t high = value & 0xF0;
    uint8_t low  = (value << 4) & 0xF0;

    LCD_Write4(high, modeRS);
    LCD_Write4(low, modeRS);
}

static void LCD_Command(uint8_t cmd)
{
    LCD_Send(cmd, 0);
    if (cmd == 0x01 || cmd == 0x02) _delay_ms(2);
}

static void LCD_Data(uint8_t d)
{
    LCD_Send(d, LCD_RS);
}

void LCD_Init(void)
{
    _delay_ms(50);

    LCD_Write4(0x30, 0);
    _delay_ms(5);
    LCD_Write4(0x30, 0);
    _delay_us(150);
    LCD_Write4(0x30, 0);
    _delay_us(150);
    LCD_Write4(0x20, 0);
    _delay_us(150);

    LCD_Command(0x28);
    LCD_Command(0x0C);
    LCD_Command(0x06);
    LCD_Command(0x01);
    _delay_ms(2);
}

void LCD_Clear(void)
{
    LCD_Command(0x01);
    _delay_ms(2);
}

void LCD_SetCursor(uint8_t row, uint8_t col)
{
    uint8_t addr = (row == 0) ? 0x00 : 0x40;
    addr += col;
    LCD_Command(0x80 | addr);
}

void LCD_Print(const char *s)
{
    while (*s) LCD_Data((uint8_t)*s++);
}

void LCD_PrintU16(uint16_t v)
{
    char buf[6];
    uint8_t i = 0;

    if (v == 0)
    {
        LCD_Data('0');
        return;
    }

    while (v > 0 && i < 5)
    {
        buf[i++] = (char)('0' + (v % 10));
        v /= 10;
    }

    while (i > 0)
    {
        LCD_Data(buf[--i]);
    }
}

/* ===================== UART ===================== */
void UART_Init(unsigned int ubrr)
{
    UBRR0H = (unsigned char)(ubrr >> 8);
    UBRR0L = (unsigned char)ubrr;

    UCSR0B = (1 << TXEN0);                       // Enable transmitter
    UCSR0C = (1 << UCSZ01) | (1 << UCSZ00);     // 8 data bits, 1 stop bit
}

void UART_TxChar(char data)
{
    while (!(UCSR0A & (1 << UDRE0)));
    UDR0 = data;
}

void UART_Print(const char *str)
{
    while (*str)
    {
        UART_TxChar(*str++);
    }
}

void UART_PrintU16(uint16_t v)
{
    char buf[6];
    uint8_t i = 0;

    if (v == 0)
    {
        UART_TxChar('0');
        return;
    }

    while (v > 0 && i < 5)
    {
        buf[i++] = (char)('0' + (v % 10));
        v /= 10;
    }

    while (i > 0)
    {
        UART_TxChar(buf[--i]);
    }
}

void UART_SendReading(uint16_t value, const char *status)
{
    UART_PrintU16(value);
    UART_TxChar(',');
    UART_Print(status);
    UART_TxChar('\n');
}

/* ===================== ADC ===================== */
void ADC_Init(void)
{
    ADMUX  = (1 << REFS0); // AVcc reference
    ADCSRA = (1 << ADEN)
           | (1 << ADPS2) | (1 << ADPS1) | (1 << ADPS0); // prescaler 128
}

uint16_t ADC_Read(uint8_t channel)
{
    channel &= 0x07;
    ADMUX = (ADMUX & 0xF8) | channel;

    ADCSRA |= (1 << ADSC);
    while (ADCSRA & (1 << ADSC));

    return ADC;
}

/* ===================== MAIN ===================== */
int main(void)
{
    uint16_t vibrationValue;
    const char *currentStatus;

    // PB0 = LED1, PB1 = LED2, PB2 = LED3, PB3 = Buzzer
    DDRB |= (1 << PB0) | (1 << PB1) | (1 << PB2) | (1 << PB3);

    ADC_Init();
    TWI_Init();
    LCD_Init();
    UART_Init(UBRR_VALUE);

    LCD_Clear();
    LCD_SetCursor(0, 0);
    LCD_Print("System Ready");
    LCD_SetCursor(1, 0);
    LCD_Print("Monitoring...");
    _delay_ms(1500);
    LCD_Clear();

    while (1)
    {
        vibrationValue = ADC_Read(0); // ADC0 (PC0 / A0)

        // Turn OFF all outputs first
        PORTB &= ~((1 << PB0) | (1 << PB1) | (1 << PB2) | (1 << PB3));

        // Determine status
        if (vibrationValue < 300)
        {
            PORTB |= (1 << PB0);
            currentStatus = "SAFE";
        }
        else if (vibrationValue < 600)
        {
            PORTB |= (1 << PB1);
            currentStatus = "MEDIUM";
        }
        else if (vibrationValue < 800)
        {
            PORTB |= (1 << PB2);
            PORTB |= (1 << PB3);
            currentStatus = "HIGH";
        }
        else
        {
            PORTB |= (1 << PB2);
            PORTB |= (1 << PB3);
            currentStatus = "ALERT";
        }

        // LCD line 1
        LCD_SetCursor(0, 0);
        LCD_Print("Vib:");
        LCD_PrintU16(vibrationValue);
        LCD_Print("     ");

        // LCD line 2
        LCD_SetCursor(1, 0);

        if (vibrationValue < 300)
        {
            LCD_Print("SAFE           ");
        }
        else if (vibrationValue < 600)
        {
            LCD_Print("MEDIUM         ");
        }
        else if (vibrationValue < 800)
        {
            LCD_Print("HIGH BUZZER ON ");
        }
        else
        {
            LCD_Print("EQ LEVEL ALERT ");
        }

        // Send to ESP32 through UART
        UART_SendReading(vibrationValue, currentStatus);

        // Extra blink effect for ALERT level
        if (vibrationValue >= 800)
        {
            _delay_ms(200);
            PORTB &= ~(1 << PB2);
            _delay_ms(100);
        }

        _delay_ms(300);
    }
}
