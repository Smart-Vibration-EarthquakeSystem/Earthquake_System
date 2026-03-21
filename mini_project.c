#define F_CPU 16000000UL

#include <avr/io.h>
#include <util/delay.h>
#include <stdint.h>

/* ===================== USER SETTINGS ===================== */
#define LCD_I2C_ADDR  0x27   // change to 0x3F if your LCD doesn't work

/* PCF8574 -> LCD typical mapping:
   P0 = RS
   P1 = RW (often tied low; we keep it 0)
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

/* ===================== TWI (I2C) ===================== */
void TWI_Init(void)
{
    // SCL ≈ 100kHz with prescaler=1: TWBR = ((F_CPU/SCL)-16)/2
    TWSR = 0x00;           // prescaler = 1
    TWBR = 72;             // ~100kHz for 16MHz
    TWCR = (1 << TWEN);    // enable TWI
}

uint8_t TWI_Start(uint8_t address_rw)
{
    TWCR = (1 << TWINT) | (1 << TWSTA) | (1 << TWEN);
    while (!(TWCR & (1 << TWINT)));

    // Load SLA+W / SLA+R
    TWDR = address_rw;
    TWCR = (1 << TWINT) | (1 << TWEN);
    while (!(TWCR & (1 << TWINT)));

    // We keep it simple: return 1 = ok (not doing full status decoding)
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
    TWI_Start((LCD_I2C_ADDR << 1) | 0); // write
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
    // nibble is upper 4 bits already aligned to P4..P7
    uint8_t data = (nibble & 0xF0) | control;
    LCD_PulseEnable(data);
}

static void LCD_Send(uint8_t value, uint8_t modeRS)
{
    uint8_t high = value & 0xF0;
    uint8_t low  = (value << 4) & 0xF0;

    LCD_Write4(high, modeRS);
    LCD_Write4(low,  modeRS);
}

static void LCD_Command(uint8_t cmd)
{
    LCD_Send(cmd, 0); // RS=0
    if (cmd == 0x01 || cmd == 0x02) _delay_
